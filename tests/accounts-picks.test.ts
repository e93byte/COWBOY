import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { AccountStore } from "../app/lib/account-store";
import { createAccountHandlers, MutationLimiter, sharedMutationLimiter } from "../app/api/account/handlers";
import { PickService } from "../app/lib/pick-service";
import type { LiveEvent } from "../app/lib/live-sports";
import { createPickHandlers } from "../app/api/picks/handlers";

const eventTime = Date.parse("2030-01-01T12:00:00.000Z");
function event(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: "401234567", league: "nba", sport: "basketball", leagueName: "NBA", name: "Away at Home",
    startsAt: new Date(eventTime + 3600000).toISOString(), status: "scheduled", statusText: "Scheduled",
    clock: null, period: null,
    home: { id: "1", name: "Home Team", shortName: "HOME", score: null },
    away: { id: "2", name: "Away Team", shortName: "AWAY", score: null }, winner: null, completed: false,
    ...overrides,
  };
}
const pick = (overrides: Record<string, unknown> = {}) => ({ eventId: "401234567", league: "nba", side: "home", requestId: "request-one", ...overrides });

const origin = "http://cowboy.test";
function request(route: string, method = "GET", body?: unknown, cookie?: string, extra: Record<string, string> = {}) {
  return new Request(origin + route, {
    method,
    headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const password = "correct-horse-local-password";
const rejectsCode = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => (error as { code: string }).code === code);
async function fixture<T>(run: (store: AccountStore, dir: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(await realpath(tmpdir()), "cowboy-accounts-"));
  try { return await run(new AccountStore({ directory: dir }), dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("registration durably stores salted hashes, exposes only a public user, and authenticates a random session", async () => {
  await fixture(async (store, dir) => {
    const registered = await store.register("Rider_7", "long-local-password");
    assert.deepEqual(Object.keys(registered.user).sort(), ["id", "username"]);
    assert.equal(registered.user.username, "Rider_7");
    assert.match(registered.token, /^[a-f0-9]{64}$/);
    assert.deepEqual(await store.getUser(registered.token), registered.user);
    const persisted = await readFile(path.join(dir, "store.json"), "utf8");
    assert.ok(!persisted.includes("long-local-password"));
    assert.ok(!persisted.includes(registered.token));
    const parsed = JSON.parse(persisted);
    assert.equal(parsed.users[0].passwordHash.length, 128);
    assert.equal(parsed.users[0].salt.length, 32);
    const restarted = new AccountStore({ directory: dir });
    assert.deepEqual(await restarted.getUser(registered.token), registered.user);
  });
});

test("login validates credentials, isolates sessions, revokes logout and expires sessions", async () => {
  await fixture(async (store, dir) => {
    const registered = await store.register("Cowboy", password);
    await rejectsCode(store.login("cowboy", "wrong-password"), "invalid_credentials");
    await rejectsCode(store.login("nobody", password), "invalid_credentials");
    const login = await store.login("cowboy", password);
    assert.deepEqual(login.user, registered.user);
    assert.notEqual(login.token, registered.token);
    await store.logout(login.token);
    assert.equal(await store.getUser(login.token), null);
    assert.deepEqual(await store.getUser(registered.token), registered.user);
    const later = new AccountStore({ directory: dir, now: () => Date.now() + 8 * 86400000 });
    assert.equal(await later.getUser(registered.token), null);
    assert.equal(await store.getUser("not-a-session"), null);
  });
});

test("registration rejects unsafe usernames, weak or oversized passwords, and concurrent case-insensitive duplicates", async () => {
  await fixture(async (store, dir) => {
    for (const username of ["ab", "x".repeat(31), " bad", "a<b", "a/b", "🦁abc"]) {
      await rejectsCode(store.register(username, password), "invalid_input");
    }
    for (const invalid of ["short", "x".repeat(129)]) {
      await rejectsCode(store.register("Rider", invalid), "invalid_input");
    }
    const other = new AccountStore({ directory: dir });
    const attempts = await Promise.allSettled([store.register("RIDER", password), other.register("rider", password)]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = attempts.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.code, "username_taken");
    const second = await store.register("Different", password);
    assert.ok(second.user.id);
    const parsed = JSON.parse(await readFile(path.join(dir, "store.json"), "utf8"));
    assert.notEqual(parsed.users[0].salt, parsed.users[1].salt);
    assert.notEqual(parsed.users[0].passwordHash, parsed.users[1].passwordHash);
  });
});

test("local credential storage refuses public paths, symlinks and corrupted data without overwriting", async () => {
  await fixture(async (store, dir) => {
    const unsafe = new AccountStore({ directory: path.join(dir, "public", "accounts") });
    await rejectsCode(unsafe.register("Unsafe", password), "unsafe_storage");
    const realPublic = path.join(process.cwd(), "public");
    await symlink(realPublic, path.join(dir, "linked"));
    const linked = new AccountStore({ directory: path.join(dir, "linked", "accounts") });
    await rejectsCode(linked.register("Unsafe", password), "unsafe_storage");
    await writeFile(path.join(dir, "store.json"), '{"version":1,"users":[]}');
    await rejectsCode(store.register("Rider", password), "storage_unavailable");
    assert.equal(await readFile(path.join(dir, "store.json"), "utf8"), '{"version":1,"users":[]}');
    await rm(path.join(dir, "store.json"));
    await store.register("Rider", password);
    assert.equal((await stat(path.join(dir, "store.json"))).mode & 0o777, 0o600);
  });
});

test("account HTTP handlers register, authenticate and logout without leaking secrets or caching", async () => {
  await fixture(async (store) => {
    const api = createAccountHandlers({ store });
    assert.deepEqual(await (await api.GET(request("/api/account"))).json(), { user: null });
    const registered = await api.POST(request("/api/account", "POST", { action: "register", username: "HttpRider", password }));
    assert.equal(registered.status, 200);
    assert.match(registered.headers.get("cache-control")!, /no-store/);
    const cookieHeader = registered.headers.get("set-cookie")!;
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Strict/i);
    assert.match(cookieHeader, /Path=\//);
    const cookie = cookieHeader.split(";")[0];
    const payload = await registered.json();
    assert.deepEqual(Object.keys(payload), ["user"]);
    assert.deepEqual(Object.keys(payload.user).sort(), ["id", "username"]);
    assert.deepEqual(await (await api.GET(request("/api/account", "GET", undefined, cookie))).json(), payload);
    const loggedOut = await api.DELETE(request("/api/account", "DELETE", undefined, cookie));
    assert.deepEqual(await loggedOut.json(), { user: null });
    assert.match(loggedOut.headers.get("set-cookie")!, /Max-Age=0/);
    assert.deepEqual(await (await api.GET(request("/api/account", "GET", undefined, cookie))).json(), { user: null });
    const loggedIn = await api.POST(request("/api/account", "POST", { action: "login", username: "httprider", password }));
    assert.equal(loggedIn.status, 200);
    assert.deepEqual(await loggedIn.json(), payload);
  });
});

test("mutating account requests reject foreign or missing origins and mismatched host headers", async () => {
  await fixture(async (store) => {
    const api = createAccountHandlers({ store });
    const invalidHeaders: Record<string, string>[] = [{ origin: "https://evil.test" }, { origin: "null" }, { host: "evil.test" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of invalidHeaders) {
      const res = await api.POST(request("/api/account", "POST", { action: "register", username: "SafeRider", password }, undefined, headers));
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "cross_origin");
    }
    const missing = new Request(origin + "/api/account", { method: "DELETE" });
    assert.equal((await api.DELETE(missing)).status, 400);
    assert.equal((await api.DELETE(request("/api/account", "DELETE", undefined, undefined, { origin: "https://evil.test" }))).status, 400);
    const https = await api.POST(new Request("https://cowboy.test/api/account", {
      method: "POST", headers: { origin: "https://cowboy.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "register", username: "SecureRider", password }),
    }));
    assert.equal(https.status, 200);
    assert.match(https.headers.get("set-cookie")!, /; Secure/);
  });
});

test("same-origin account checks accept a public origin when Next receives an internal proxy URL", async () => {
  await fixture(async (store) => {
    const api = createAccountHandlers({ store });
    const proxied = new Request("http://next-internal:3210/api/account", {
      method: "POST",
      headers: {
        origin: "https://cowboy.example",
        host: "cowboy.example",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "register", username: "ProxyRider", password }),
    });
    const accepted = await api.POST(proxied);
    assert.equal(accepted.status, 200);
    assert.deepEqual((await accepted.json()).user.username, "ProxyRider");

    const foreign = new Request("http://next-internal:3210/api/account", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        host: "cowboy.example",
        "x-forwarded-proto": "https",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "register", username: "ForeignRider", password }),
    });
    const rejected = await api.POST(foreign);
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error, "cross_origin");
  });
});

test("account requests bound JSON size and reject malformed, extra and money fields", async () => {
  await fixture(async (store) => {
    const api = createAccountHandlers({ store });
    for (const payload of [null, [], {}, { action: "register", username: "Rider", password, stake: 10 }, { action: "register", username: {}, password }]) {
      const result = await api.POST(request("/api/account", "POST", payload));
      assert.equal(result.status, 400);
      assert.deepEqual(Object.keys(await result.json()).sort(), ["error", "message"]);
    }
    for (const body of ["{", "x".repeat(4097)]) {
      const result = await api.POST(new Request(origin + "/api/account", { method: "POST", headers: { origin, "content-type": "application/json" }, body }));
      assert.equal(result.status, 400);
    }
    assert.equal((await api.POST(request("/api/account", "POST", {}, undefined, { "content-type": "text/plain" }))).status, 400);
  });
});

test("basic auth throttling limits username attempts and resets after its window", async () => {
  await fixture(async (store) => {
    let time = 1000;
    const limiter = new MutationLimiter({ now: () => time, limit: 2, windowMs: 1000 });
    const api = createAccountHandlers({ store, limiter });
    await store.register("RateRider", password);
    const attempt = () => api.POST(request("/api/account", "POST", { action: "login", username: "RateRider", password: "wrong-password" }));
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 401);
    const limited = await attempt();
    assert.equal(limited.status, 409);
    assert.equal((await limited.json()).error, "rate_limited");
    time += 1001;
    assert.equal((await attempt()).status, 401);
  });
});

test("authenticated scheduled picks snapshot real provider selections, survive restart and stay user-isolated", async () => {
  await fixture(async (store, dir) => {
    const first = await store.register("FirstRider", password);
    const second = await store.register("SecondRider", password);
    const getEvent = async (league: string, id: string) => {
      assert.equal(league, "nba"); assert.equal(id, "401234567"); return event();
    };
    const service = new PickService({ store, getEvent, now: () => eventTime });
    await rejectsCode(service.submit(null, pick()), "unauthorized");
    const ticket = await service.submit(first.token, pick());
    assert.deepEqual(ticket, {
      id: ticket.id, eventId: "401234567", league: "nba", eventName: "Away at Home", selection: "Home Team",
      side: "home", startsAt: event().startsAt, createdAt: new Date(eventTime).toISOString(), status: "open", settledAt: null,
    });
    assert.deepEqual(await service.list(second.token), []);
    const restarted = new PickService({ store: new AccountStore({ directory: dir }), getEvent, now: () => eventTime });
    assert.deepEqual(await restarted.list(first.token), [ticket]);
    const own = await service.submit(second.token, pick({ side: "away" }));
    assert.equal(own.selection, "Away Team");
    assert.notEqual(own.id, ticket.id);
  });
});

test("pick entry rejects unverified, unavailable, missing-team, started or non-scheduled events", async () => {
  await fixture(async (store) => {
    const { token } = await store.register("EntryRider", password);
    const blocked: Array<LiveEvent | null> = [
      null, event({ status: "live" }), event({ status: "final", completed: true, winner: "home" }),
      event({ status: "cancelled" }), event({ status: "postponed" }), event({ status: "unknown" }),
      event({ startsAt: new Date(eventTime).toISOString() }), event({ startsAt: "invalid" }),
      event({ completed: true }), event({ winner: "home" }), event({ id: "different" }), event({ league: "nhl" }),
      event({ home: { ...event().home, id: "" } }), event({ away: { ...event().home } }),
      event({ away: { ...event().away, name: "" } }),
    ];
    for (const current of blocked) {
      const service = new PickService({ store, getEvent: async () => current, now: () => eventTime });
      await assert.rejects(service.submit(token, pick()), (error: unknown) => (error as { status: number }).status === 409);
      assert.deepEqual(await service.list(token), []);
    }
    const unavailable = new PickService({ store, getEvent: async () => { throw new Error("private upstream details"); }, now: () => eventTime });
    await rejectsCode(unavailable.submit(token, pick()), "feed_unavailable");
  });
});

test("pick inputs reject money, unknown sides and draw entry rather than trusting client selections", async () => {
  await fixture(async (store) => {
    const { token } = await store.register("InputRider", password);
    const service = new PickService({ store, getEvent: async () => { throw new Error("must not call feed"); }, now: () => eventTime });
    for (const input of [null, [], {}, pick({ side: "nonexistent-team" }), pick({ side: "draw" }), pick({ stake: 10 }), pick({ price: 1.5 }), pick({ eventId: "../bad" }), pick({ league: "https://evil.test" }), pick({ requestId: "" }), pick({ eventId: "x".repeat(101) })]) {
      await rejectsCode(service.submit(token, input), "invalid_input");
    }
  });
});

test("serial writes reject duplicate event picks and replays across concurrent store instances", async () => {
  await fixture(async (store, dir) => {
    const { token } = await store.register("RaceRider", password);
    const one = new PickService({ store, getEvent: async () => event(), now: () => eventTime });
    const two = new PickService({ store: new AccountStore({ directory: dir }), getEvent: async () => event(), now: () => eventTime });
    const attempts = await Promise.allSettled([one.submit(token, pick()), two.submit(token, pick())]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await one.list(token)).length, 1);
    await rejectsCode(one.submit(token, pick({ requestId: "request-two", side: "away" })), "duplicate_pick");
    const different = new PickService({ store, getEvent: async () => event({ id: "401234568" }), now: () => eventTime });
    await rejectsCode(different.submit(token, pick({ eventId: "401234568" })), "request_replayed");
  });
});

test("refresh grades only authoritative completed winners and never infers a result from scores", async () => {
  await fixture(async (store) => {
    const first = await store.register("WinnerRider", password);
    const second = await store.register("OtherRider", password);
    let current: LiveEvent | null = event();
    const service = new PickService({ store, getEvent: async () => current, now: () => eventTime });
    const firstTicket = await service.submit(first.token, pick());
    const otherTicket = await service.submit(second.token, pick({ side: "away" }));
    for (const uncertain of [
      null, event({ status: "unknown", winner: "home", completed: true }), event({ status: "live", winner: "home" }),
      event({ status: "postponed" }), event({ status: "final", completed: false, winner: "home" }),
      event({ status: "final", completed: true, winner: null, home: { ...event().home, score: 100 }, away: { ...event().away, score: 90 } }),
      event({ status: "final", completed: true, winner: "home", id: "wrong-id" }),
      event({ status: "final", completed: true, winner: "home", home: { ...event().home, id: "different-team" } }),
    ]) {
      current = uncertain;
      assert.deepEqual(await service.refresh(first.token), [firstTicket]);
    }
    current = event({ status: "final", completed: true, winner: "home" });
    const won = await service.refresh(first.token);
    assert.equal(won[0].status, "won");
    assert.equal(won[0].settledAt, new Date(eventTime).toISOString());
    assert.deepEqual(await service.list(second.token), [otherTicket]);
    const lost = await service.refresh(second.token);
    assert.equal(lost[0].status, "lost");
    current = event({ status: "final", completed: true, winner: "away" });
    assert.deepEqual(await service.refresh(first.token), won);
  });
});

test("authoritative cancellation voids picks but provider failures leave durable tickets unchanged", async () => {
  await fixture(async (store) => {
    const { token } = await store.register("VoidRider", password);
    let fails = false;
    let current = event();
    const service = new PickService({ store, getEvent: async () => { if (fails) throw new Error("provider down"); return current; }, now: () => eventTime });
    const ticket = await service.submit(token, pick());
    fails = true;
    await rejectsCode(service.refresh(token), "feed_unavailable");
    assert.deepEqual(await service.list(token), [ticket]);
    fails = false;
    current = event({ status: "cancelled" });
    const result = await service.refresh(token);
    assert.equal(result[0].status, "void");
    assert.ok(result[0].settledAt);
    await store.logout(token);
    await rejectsCode(service.refresh(token), "unauthorized");
  });
});

test("cancellation is owner-only and allowed solely before the original and freshly verified start lock", async () => {
  await fixture(async (store) => {
    const first = await store.register("CancelRider", password);
    const other = await store.register("NoAccessRider", password);
    let current: LiveEvent | null = event();
    let time = eventTime;
    const service = new PickService({ store, getEvent: async () => current, now: () => time });
    const ticket = await service.submit(first.token, pick());
    await rejectsCode(service.cancel(other.token, ticket.id), "ticket_unavailable");
    await rejectsCode(service.cancel(null, ticket.id), "unauthorized");
    await rejectsCode(service.cancel(first.token, "../bad-id"), "invalid_input");
    for (const blocked of [null, event({ status: "live" }), event({ status: "unknown" }), event({ status: "postponed" }), event({ home: { ...event().home, id: "changed-team" } })]) {
      current = blocked;
      await assert.rejects(service.cancel(first.token, ticket.id));
      assert.equal((await service.list(first.token))[0].status, "open");
    }
    time = eventTime + 3600000;
    current = event({ startsAt: new Date(time + 3600000).toISOString() });
    await rejectsCode(service.cancel(first.token, ticket.id), "event_locked");
    time = eventTime;
    current = event();
    const cancelled = await service.cancel(first.token, ticket.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.settledAt, new Date(eventTime).toISOString());
    await rejectsCode(service.cancel(first.token, ticket.id), "event_locked");
    current = event({ status: "final", completed: true, winner: "home" });
    assert.equal((await service.refresh(first.token))[0].status, "cancelled");
    current = event();
    await rejectsCode(service.submit(first.token, pick({ requestId: "new-request-id" })), "duplicate_pick");
  });
});

test("pick HTTP handlers authenticate, submit, list, settle and protect all mutations", async () => {
  await fixture(async (store) => {
    const accountApi = createAccountHandlers({ store });
    const registered = await accountApi.POST(request("/api/account", "POST", { action: "register", username: "IntegrationRider", password }));
    const cookie = registered.headers.get("set-cookie")!.split(";")[0];
    let current = event();
    const service = new PickService({ store, getEvent: async () => current, now: () => eventTime });
    const api = createPickHandlers({ service });
    for (const response of [await api.GET(request("/api/picks")), await api.POST(request("/api/picks", "POST", pick())), await api.REFRESH(request("/api/picks/refresh", "POST", {})), await api.DELETE(request("/api/picks?id=unknown", "DELETE"))]) {
      assert.equal(response.status, 401);
      assert.deepEqual(Object.keys(await response.json()).sort(), ["error", "message"]);
    }
    assert.equal((await api.POST(request("/api/picks", "POST", pick({ stake: 2 }), cookie))).status, 400);
    const saved = await api.POST(request("/api/picks", "POST", pick(), cookie));
    assert.equal(saved.status, 200);
    const { ticket } = await saved.json();
    const list = await api.GET(request("/api/picks", "GET", undefined, cookie));
    assert.deepEqual(await list.json(), { tickets: [ticket] });
    assert.match(list.headers.get("cache-control")!, /no-store/);
    const replay = await api.POST(request("/api/picks", "POST", pick(), cookie));
    assert.equal(replay.status, 409);
    for (const invoke of [
      () => api.POST(request("/api/picks", "POST", pick(), cookie, { origin: "https://evil.test" })),
      () => api.REFRESH(request("/api/picks/refresh", "POST", {}, cookie, { origin: "https://evil.test" })),
      () => api.DELETE(request("/api/picks?id=" + ticket.id, "DELETE", undefined, cookie, { origin: "https://evil.test" })),
    ]) assert.equal((await invoke()).status, 400);
    assert.equal((await api.REFRESH(request("/api/picks/refresh", "POST", { price: 2 }, cookie))).status, 400);
    current = event({ status: "final", completed: true, winner: "home" });
    const refreshed = await api.REFRESH(request("/api/picks/refresh", "POST", {}, cookie));
    assert.equal(refreshed.status, 200);
    assert.equal((await refreshed.json()).tickets[0].status, "won");
    assert.equal((await api.DELETE(request("/api/picks?id=" + ticket.id, "DELETE", undefined, cookie))).status, 409);
  });
});

test("pick HTTP cancellation validates id parameters and returns the persisted cancelled ticket", async () => {
  await fixture(async (store) => {
    const { token } = await store.register("DeleteRider", password);
    const cookie = `cowboy_session=${token}`;
    const service = new PickService({ store, getEvent: async () => event(), now: () => eventTime });
    const api = createPickHandlers({ service });
    const ticket = await service.submit(token, pick());
    for (const suffix of ["", "?id=bad", `?id=${ticket.id}&id=${ticket.id}`, `?id=${ticket.id}&stake=10`]) {
      assert.equal((await api.DELETE(request("/api/picks" + suffix, "DELETE", undefined, cookie))).status, 400);
    }
    const result = await api.DELETE(request("/api/picks?id=" + ticket.id, "DELETE", undefined, cookie));
    assert.equal(result.status, 200);
    const cancelled = (await result.json()).ticket;
    assert.equal(cancelled.status, "cancelled");
    assert.deepEqual(await (await api.GET(request("/api/picks", "GET", undefined, cookie))).json(), { tickets: [cancelled] });
  });
});

test("real loopback HTTP roundtrip uses durable account sessions and the same route handlers", async () => {
  await fixture(async (store) => {
    const account = createAccountHandlers({ store });
    let current = event();
    const picks = createPickHandlers({ service: new PickService({ store, getEvent: async () => current, now: () => eventTime }) });
    // A real HTTP adapter, not mocked fetch. Production Next route exports use these same handlers.
    const server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const url = `http://${incoming.headers.host}${incoming.url}`;
        const req = new Request(url, { method: incoming.method, headers, ...(["GET", "HEAD"].includes(incoming.method!) || !chunks.length ? {} : { body: Buffer.concat(chunks) }) });
        const route = new URL(url).pathname;
        const handler = route === "/api/account" ? account[incoming.method as keyof typeof account]
          : route === "/api/picks/refresh" ? picks.REFRESH : picks[incoming.method as "GET" | "POST" | "DELETE"];
        const result = await handler(req);
        outgoing.writeHead(result.status, Object.fromEntries(result.headers));
        outgoing.end(Buffer.from(await result.arrayBuffer()));
      } catch { outgoing.writeHead(500); outgoing.end(); }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const send = (route: string, method = "GET", body?: unknown, cookie?: string) => fetch(base + route, {
        method, headers: { origin: base, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.deepEqual(await (await send("/api/account")).json(), { user: null });
      assert.equal((await send("/api/picks")).status, 401);
      const registered = await send("/api/account", "POST", { action: "register", username: "NetworkRider", password });
      assert.equal(registered.status, 200);
      const user = await registered.json();
      const cookie = registered.headers.get("set-cookie")!.split(";")[0];
      assert.deepEqual(await (await send("/api/account", "GET", undefined, cookie)).json(), user);
      const saved = await send("/api/picks", "POST", pick(), cookie);
      assert.equal(saved.status, 200);
      const ticket = (await saved.json()).ticket;
      assert.deepEqual(await (await send("/api/picks", "GET", undefined, cookie)).json(), { tickets: [ticket] });
      current = event({ status: "final", completed: true, winner: "away" });
      assert.equal((await (await send("/api/picks/refresh", "POST", {}, cookie)).json()).tickets[0].status, "lost");
      assert.equal((await send("/api/account", "DELETE", undefined, cookie)).status, 200);
      assert.equal((await send("/api/picks", "GET", undefined, cookie)).status, 401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

test("logout or session expiry while the provider is pending cannot authorize a later pick write", async () => {
  await fixture(async (_store, dir) => {
    let clock = eventTime;
    const store = new AccountStore({ directory: dir, now: () => clock });
    const first = await store.register("PendingRider", password);
    let reached!: () => void;
    let release!: (value: LiveEvent) => void;
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    const feed = new Promise<LiveEvent>((resolve) => { release = resolve; });
    const service = new PickService({ store, now: () => clock, getEvent: async () => { reached(); return feed; } });
    const pending = service.submit(first.token, pick());
    await entered;
    await store.logout(first.token);
    release(event());
    await rejectsCode(pending, "unauthorized");
    const second = await store.login("PendingRider", password);
    assert.deepEqual(await service.list(second.token), []);
    const expiring = new PickService({ store, now: () => clock, getEvent: async () => { clock += 8 * 86400000; return event({ startsAt: new Date(clock + 3600000).toISOString() }); } });
    await rejectsCode(expiring.submit(second.token, pick()), "unauthorized");
  });
});

test("production route bundles share a process-local throttle instead of separate refresh and submit limits", () => {
  const name = "test-shared-picks-throttle";
  const first = sharedMutationLimiter(name, { limit: 1 });
  const second = sharedMutationLimiter(name, { limit: 999 });
  first.check("user");
  assert.throws(() => second.check("user"), (error: unknown) => (error as { code: string }).code === "rate_limited");
});

test("PATCH edits an owner pick once, stores its revision history and closes at kickoff", async () => {
  await fixture(async (store, dir) => {
    const {token} = await store.register("EditRider", password);
    const other = await store.register("OtherRider", password);
    let time = eventTime;
    let source = event();
    const service = new PickService({store, getEvent: async () => source, now: () => time});
    const api = createPickHandlers({service});
    const ticket = await service.submit(token, pick());
    const patch = (body: unknown, session = token) =>
      api.PATCH(request("/api/picks", "PATCH", body, `cowboy_session=${session}`));
    const change = {id:ticket.id, side:"away", revision:0};
    assert.equal((await patch({...change, side:"draw"})).status, 400);
    assert.equal((await patch(change, other.token)).status, 409);
    source = event({status:"live"});
    assert.equal((await patch(change)).status, 409);
    assert.deepEqual(await service.list(token), [ticket]);
    source = event();
    const replies = await Promise.all([patch(change), patch(change)]);
    assert.deepEqual(replies.map(result => result.status).sort(), [200,409]);
    const edited = (await replies.find(result => result.ok)!.json()).ticket;
    assert.equal(edited.id, ticket.id);
    assert.equal(edited.createdAt, ticket.createdAt);
    assert.equal(edited.side, "away");
    assert.equal(edited.selection, "Away Team");
    assert.deepEqual(edited.changes, [{side:"home", selection:"Home Team", changedAt:new Date(time).toISOString()}]);
    const restarted = new PickService({store:new AccountStore({directory:dir}), getEvent:async () => source, now:() => time});
    assert.deepEqual(await restarted.list(token), [edited]);
    time = Date.parse(ticket.startsAt);
    assert.equal((await patch({...change, side:"home", revision:1})).status, 409);
    source = event({status:"final", completed:true, winner:"away"});
    assert.equal((await service.refresh(token))[0].status, "won");
  });
});

test("multi-game review commits together, rejects a locked game and safely replays the same batch", async () => {
  await fixture(async (store) => {
    const {token}=await store.register("BatchRider", password);
    const cookie=`cowboy_session=${token}`;
    const first=event();
    let second=event({id:"401234568",status:"live"});
    const service=new PickService({store,getEvent:async (_league,id)=>id===first.id?first:second,now:()=>eventTime});
    const handlers=createPickHandlers({service});
    const picks=[pick(),pick({eventId:second.id,side:"away",requestId:"request-two"})];
    const send=(items:unknown[])=>handlers.BATCH(request("/api/picks/batch","POST",{picks:items},cookie));
    assert.equal((await send([picks[0],picks[0]])).status,400);
    assert.equal((await send(picks)).status,409);
    assert.deepEqual(await service.list(token),[]);
    second=event({id:second.id});
    const saved=await send(picks);
    assert.equal(saved.status,200);
    const {tickets}=await saved.json();
    assert.deepEqual(tickets.map((ticket:{eventId:string})=>ticket.eventId),[first.id,second.id]);
    const replay=await send(picks);
    assert.equal(replay.status,200);
    assert.deepEqual((await replay.json()).tickets,tickets);
    assert.equal((await service.list(token)).length,2);
  });
});

test("a valid soccer draw can be submitted or edited and settles as its own outcome", async () => {
  await fixture(async store => {
    const drawPicker = await store.register("DrawRider",password);
    const editPicker = await store.register("EditDrawRider",password);
    const teamPicker = await store.register("TeamRider",password);
    let current = event({league:"epl",sport:"soccer",leagueName:"Premier League"});
    const service = new PickService({store,getEvent:async () => current,now:() => eventTime});
    const draw = await service.submit(drawPicker.token,pick({league:"epl",side:"draw"}));
    const team = await service.submit(teamPicker.token,pick({league:"epl",side:"home"}));
    const first = await service.submit(editPicker.token,pick({league:"epl",side:"away"}));
    const changed = await service.edit(editPicker.token,{id:first.id,side:"draw",revision:0});
    assert.equal(draw.selection,"Draw");
    assert.equal(changed.selection,"Draw");
    assert.equal(changed.changes?.[0].side,"away");
    current = {...current,status:"final",completed:true,winner:"draw"};
    assert.equal((await service.refresh(drawPicker.token))[0].status,"won");
    assert.equal((await service.refresh(editPicker.token))[0].status,"won");
    assert.equal((await service.refresh(teamPicker.token)).find(ticket=>ticket.id===team.id)?.status,"lost");
  });
});

test("account follows are owner-isolated, durable, idempotent and safe across concurrent updates", async () => {
  const {createFollowHandlers} = await import("../app/api/account/follows/handlers");
  await fixture(async (store,dir) => {
    const owner = await store.register("FollowRider",password);
    const other = await store.register("DifferentRider",password);
    const endpoint = "/api/account/follows";
    const headers = (token: string) => `cowboy_session=${token}`;
    const handlers = createFollowHandlers({store});
    const game = {kind:"game",id:"nba:401234567",league:"nba",name:"Away at Home"};
    const team = {kind:"team",id:"nba:14",league:"nba",name:"Miami Heat"};
    const patch = (entries:unknown[],following:boolean,token=owner.token) =>
      handlers.PATCH(request(endpoint,"PATCH",{entries,following},headers(token)));
    const get = (token:string) => handlers.GET(request(endpoint,"GET",undefined,headers(token)));
    assert.equal((await handlers.GET(request(endpoint))).status,401);
    assert.equal((await patch([{...game,id:'nba:../../private'}],true)).status,400);
    assert.equal((await patch([{...game,league:'not-a-league',id:'not-a-league:401234567'}],true)).status,400);
    assert.equal((await handlers.PATCH(request(endpoint,"PATCH",{entries:[game],following:true},
      headers(owner.token),{origin:"https://elsewhere.test"}))).status,400);
    const writes = await Promise.all([patch([game],true),patch([team],true)]);
    assert.ok(writes.every(response=>response.status===200));
    assert.equal((await patch([game],true)).status,200);
    assert.deepEqual((await (await get(owner.token)).json()).follows.sort((a:{kind:string},b:{kind:string})=>a.kind.localeCompare(b.kind)),[game,team]);
    assert.deepEqual(await (await get(other.token)).json(),{follows:[]});
    const restored = createFollowHandlers({store:new AccountStore({directory:dir})});
    assert.equal((await (await restored.GET(request(endpoint,"GET",undefined,headers(owner.token)))).json()).follows.length,2);
    assert.equal((await patch([game],false)).status,200);
    assert.deepEqual(await (await get(owner.token)).json(),{follows:[team]});
    assert.deepEqual(await store.getUser(owner.token),owner.user);
  });
});

test("exports only the requesting account's public data and revokes other sessions without affecting other users", async () => {
  const {createAccountDataHandlers}=await import("../app/api/account/data-handlers");
  const {createFollowHandlers}=await import("../app/api/account/follows/handlers");
  await fixture(async store => {
    const owner=await store.register("ExportRider",password);
    const second=await store.login(owner.user.username,password);
    const third=await store.register("AnotherOwner",password);
    const cookie=(token:string)=>`cowboy_session=${token}`;
    const service=new PickService({store,getEvent:async () => event(),now:()=>eventTime});
    const ticket=await service.submit(owner.token,pick());
    await service.submit(third.token,pick({requestId:"third-request"}));
    const watch={kind:"league",id:"nba",league:"nba",name:"NBA"};
    const watched=await createFollowHandlers({store}).PATCH(request("/api/account/follows","PATCH",{entries:[watch],following:true},cookie(owner.token)));
    assert.equal(watched.status,200);
    const handlers=createAccountDataHandlers({store});
    const getExport=(token?:string)=>handlers.export(request("/api/account/export","GET",undefined,token ? cookie(token) : undefined));
    const revoke=(token:string,extra?:Record<string,string>)=>handlers.revokeSessions(request("/api/account/sessions","POST",{},cookie(token),extra));
    assert.equal((await getExport()).status,401);
    const exported=await getExport(owner.token);
    assert.equal(exported.headers.get("cache-control"),"private, no-store");
    assert.match(exported.headers.get("content-disposition") ?? "",/attachment; filename="cowboy-account.json"/);
    const data=await exported.json();
    assert.deepEqual(data.account,owner.user);
    assert.deepEqual(data.follows,[watch]);
    assert.deepEqual(data.picks,[ticket]);
    const encoded=JSON.stringify(data);
    for(const secret of ["request-one","third-request","passwordHash",owner.token,second.token,third.user.username]) assert.ok(!encoded.includes(secret));
    assert.equal((await revoke(owner.token,{origin:"https://elsewhere.test"})).status,400);
    assert.deepEqual(await (await revoke(owner.token)).json(),{revoked:1});
    assert.equal((await getExport(second.token)).status,401);
    assert.equal((await getExport(owner.token)).status,200);
    assert.equal((await getExport(third.token)).status,200);
    assert.deepEqual(await (await revoke(owner.token)).json(),{revoked:0});
  });
});

test("account deletion requires the current password and removes only the owner and their sessions and picks", async () => {
  const {createAccountDataHandlers}=await import("../app/api/account/data-handlers");
  const {createFollowHandlers}=await import("../app/api/account/follows/handlers");
  await fixture(async (store,dir) => {
    const owner=await store.register("DeleteOwner",password);
    const otherSession=await store.login(owner.user.username,password);
    const separate=await store.register("KeepOwner",password);
    const cookie=(token:string)=>`cowboy_session=${token}`;
    const service=new PickService({store,getEvent:async()=>event(),now:()=>eventTime});
    await service.submit(owner.token,pick());
    const kept=await service.submit(separate.token,pick({requestId:"keep-user-pick"}));
    const follows=createFollowHandlers({store});
    const watch={entries:[{kind:"league",id:"nba",league:"nba",name:"NBA"}],following:true};
    assert.equal((await follows.PATCH(request("/api/account/follows","PATCH",watch,cookie(owner.token)))).status,200);
    const handlers=createAccountDataHandlers({store});
    const remove=(value:unknown,token?:string,extra?:Record<string,string>)=>
      handlers.delete(request("/api/account/delete","DELETE",value,token?cookie(token):undefined,extra));
    assert.equal((await remove({password})).status,401);
    assert.equal((await remove({password},owner.token,{origin:"https://elsewhere.test"})).status,400);
    assert.equal((await remove({password:"incorrect-test-password"},owner.token)).status,401);
    assert.deepEqual(await store.getUser(otherSession.token),owner.user);
    assert.equal((await service.list(owner.token)).length,1);
    const deleted=await remove({password},owner.token);
    assert.equal(deleted.status,200);
    assert.match(deleted.headers.get("set-cookie") ?? "",/Max-Age=0/);
    assert.equal(await store.getUser(owner.token),null);
    assert.equal(await store.getUser(otherSession.token),null);
    assert.equal((await remove({password},owner.token)).status,401);
    assert.deepEqual(await store.getUser(separate.token),separate.user);
    assert.deepEqual(await service.list(separate.token),[kept]);
    const persisted=await readFile(path.join(dir,"store.json"),"utf8");
    assert.ok(!persisted.includes(owner.user.id));
    assert.ok(!persisted.includes(owner.user.username));
    const newUser=await store.register(owner.user.username,password);
    assert.notEqual(newUser.user.id,owner.user.id);
    assert.deepEqual(await service.list(newUser.token),[]);
  });
});
