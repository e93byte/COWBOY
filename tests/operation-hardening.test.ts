import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { AccountStore } from "../app/lib/account-store";
import { PickService } from "../app/lib/pick-service";
import { createLiveSportsClient, normalizeScoreboard, type LiveEvent } from "../app/lib/live-sports";
import { sessionToken } from "../app/api/account/handlers";

const root = path.join(process.cwd(), ".operation-hardening-tmp");
const password = "operation-test-password-only";
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
async function fixture(run: (store: AccountStore, directory: string) => Promise<void>) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(root, "store-"));
  try { await run(new AccountStore({ directory }), directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const input = { eventId: "401234567", league: "nba", side: "home", requestId: "hardening-request" };
const now = Date.parse("2030-01-01T00:00:00Z");
function event(id = input.eventId): LiveEvent {
  return { id, league: "nba", sport: "basketball", leagueName: "NBA", name: "Away at Home", startsAt: new Date(now + 60000).toISOString(),
    status: "scheduled", statusText: "Scheduled", clock: null, period: null, completed: false, winner: null,
    home: { id: "1", name: "Home", shortName: "H", score: null }, away: { id: "2", name: "Away", shortName: "A", score: null } };
}

test("start time is rechecked after an awaited provider response, not only before network work", async () => {
  await fixture(async (store) => {
    const { token } = await store.register("ClockRider", password);
    let clock = now;
    const service = new PickService({ store, now: () => clock, getEvent: async () => { clock = now + 60000; return event(); } });
    await assert.rejects(service.submit(token, input), code("event_locked"));
    assert.deepEqual(await service.list(token), []);
  });
});

test("multi-event settlement remains durable and atomic if a later upstream lookup fails", async () => {
  await fixture(async (store, directory) => {
    const { token } = await store.register("AtomicRider", password);
    let grading = false;
    const service = new PickService({ store, now: () => now, getEvent: async (_league, id) => {
      if (grading && id === "401234568") throw new Error("test-only upstream failure");
      return grading ? { ...event(id), status: "final", completed: true, winner: "home" } : event(id);
    } });
    await service.submit(token, input);
    await service.submit(token, { ...input, eventId: "401234568", requestId: "second-request" });
    const before = await readFile(path.join(directory, "store.json"), "utf8");
    grading = true;
    await assert.rejects(service.refresh(token), code("feed_unavailable"));
    assert.equal(await readFile(path.join(directory, "store.json"), "utf8"), before);
    assert.ok((await service.list(token)).every((ticket) => ticket.status === "open"));
  });
});

test("logout while cancellation or settlement awaits upstream prevents either write", async () => {
  for (const operation of ["cancel", "refresh"] as const) {
    await fixture(async (store, directory) => {
      const account = await store.register("RevokedRider", password);
      const initial = new PickService({ store, now: () => now, getEvent: async () => event() });
      const ticket = await initial.submit(account.token, input);
      const pending = new PickService({ store, now: () => now, getEvent: async () => {
        await store.logout(account.token);
        return operation === "refresh" ? { ...event(), status: "final", completed: true, winner: "home" } : event();
      } });
      await assert.rejects(operation === "cancel" ? pending.cancel(account.token, ticket.id) : pending.refresh(account.token), code("unauthorized"));
      const restarted = new AccountStore({ directory });
      const login = await restarted.login("RevokedRider", password);
      assert.deepEqual(await new PickService({ store: restarted, now: () => now, getEvent: async () => event() }).list(login.token), [ticket]);
    });
  }
});

test("rejected upstream responses release unread streams rather than retaining network work", async () => {
  for (const status of [404, 429, 503, 200]) {
    let cancelled = false;
    const client = createLiveSportsClient({ fetch: async () => new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { status, headers: { "content-type": "text/html" } }) });
    if (status === 404) assert.equal(await client.getLiveEvent("nba", "401234567"), null);
    else await assert.rejects(client.getLiveEvent("nba", "401234567"));
    assert.equal(cancelled, true, `HTTP ${status} response must be released`);
  }
});

test("ambiguous duplicate session cookies never select an authenticated identity", () => {
  const first = "a".repeat(64);
  const second = "b".repeat(64);
  for (const cookie of [`cowboy_session=${first}; cowboy_session=${second}`, `cowboy_session=${first}; cowboy_session=${first}`]) {
    assert.equal(sessionToken(new Request("https://cowboy.test/api/account", { headers: { cookie } })), null);
  }
  assert.equal(sessionToken(new Request("https://cowboy.test/api/account", { headers: { cookie: `theme=dark; cowboy_session=${first}` } })), first);
});

test("upstream JSON is size-bounded even when content length is absent or untrusted", async () => {
  for (const headers of [{}, { "content-length": "999999999" }] as Record<string, string>[]) {
    let cancelled = false;
    let chunks = 0;
    const client = createLiveSportsClient({ maxResponseBytes: 128, fetch: async () => new Response(new ReadableStream({
      pull(controller) {
        if (chunks++ === 0) controller.enqueue(new TextEncoder().encode(JSON.stringify({ padding: "x".repeat(200) })));
        else if (chunks < 4) controller.enqueue(new TextEncoder().encode(" "));
        else controller.close();
      },
      cancel() { cancelled = true; },
    }), { headers: { "content-type": "application/json", ...headers } }) });
    await assert.rejects(client.getLiveEvent("nba", "401234567"), /response exceeds.*byte limit/i);
    assert.equal(cancelled, true);
  }
});

test("conflicting duplicate source contest identifiers cannot silently select an authoritative result", async () => {
  const fixtures = JSON.parse(await readFile(new URL("./fixtures/live-sports/scoreboards.json", import.meta.url), "utf8"));
  const first = structuredClone(fixtures.nfl.events[0]);
  const conflicting = structuredClone(first);
  conflicting.competitions[0].competitors.reverse();
  conflicting.competitions[0].competitors[0].team.displayName = "Conflicting provider identity";
  assert.throws(() => normalizeScoreboard("nfl", { events: [first, conflicting] }), /duplicate competition identifier/i);
});

test("structurally valid JSON with invalid sessions or duplicate identities fails closed and stays untouched", async () => {
  await fixture(async (store, directory) => {
    const { token } = await store.register("SchemaRider", password);
    const file = path.join(directory, "store.json");
    const original = JSON.parse(await readFile(file, "utf8"));
    const invalid = [
      { ...original, sessions: [{ ...original.sessions[0], expiresAt: String(Date.now() + 86400000) }] },
      { ...original, sessions: [{ ...original.sessions[0], userId: "missing-user" }] },
      { ...original, users: [...original.users, { ...original.users[0] }] },
      { ...original, users: [{ ...original.users[0], passwordHash: "bad" }] },
      { ...original, tickets: [null] },
    ];
    for (const data of invalid) {
      const content = JSON.stringify(data);
      await writeFile(file, content, { mode: 0o600 });
      await assert.rejects(store.getUser(token), code("storage_unavailable"));
      await assert.rejects(store.register("AnotherRider", password), code("storage_unavailable"));
      assert.equal(await readFile(file, "utf8"), content);
    }
  });
});

test("account reads refuse exposed credential files without overwriting or authenticating", async () => {
  await fixture(async (store, directory) => {
    const { token } = await store.register("PrivateRider", password);
    const file = path.join(directory, "store.json");
    const original = await readFile(file, "utf8");
    await chmod(file, 0o644);
    await assert.rejects(store.getUser(token), code("unsafe_storage"));
    assert.equal(await readFile(file, "utf8"), original);
    await chmod(file, 0o600);
    assert.ok(await store.getUser(token));
  });
});

test("picks reject unsupported leagues and non-provider identifiers before upstream work", async () => {
  await fixture(async (store) => {
    const { token } = await store.register("ValidateRider", password);
    let calls = 0;
    const service = new PickService({ store, getEvent: async () => { calls++; return null; } });
    for (const patch of [{ league: "private" }, { league: "pga" }, { eventId: "abc" }, { eventId: "1_2" }, { eventId: "12345678901234567" }]) {
      await assert.rejects(service.submit(token, { ...input, ...patch }), code("invalid_input"));
    }
    assert.equal(calls, 0);
  });
});
