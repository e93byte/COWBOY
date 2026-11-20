import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AccountError, type StoredPick } from "../app/lib/account-store";
import { SupabaseStore } from "../app/lib/supabase-store";

const config = { url: "https://example.supabase.co", serviceKey: "service-key" };
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

type Call = { fn: string; args: Record<string, unknown>; headers: Record<string, string> };

function stubFetch(handler: (call: Call) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const fn = url.split("/rest/v1/rpc/")[1];
    const call: Call = {
      fn,
      args: JSON.parse(String(init?.body ?? "{}")),
      headers: init?.headers as Record<string, string>,
    };
    calls.push(call);
    const result = await handler(call);
    const status = result.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(result.body ?? null), {
      status, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function rpcError(message: string, status = 400) {
  return { status, body: { code: "P0001", message, details: null, hint: null } };
}

test("supabase store registers, hashes the session token and maps RPC errors", async () => {
  const { calls, restore } = stubFetch((call) => {
    if (call.fn === "cowboy_register") {
      assert.equal(call.args.p_username, "HashRider");
      assert.equal(call.args.p_username_key, "hashrider");
      assert.match(call.args.p_token_hash as string, /^[a-f0-9]{64}$/);
      assert.equal(call.headers.apikey, "service-key");
      assert.equal(call.headers.Authorization, "Bearer service-key");
      return { body: { id: "u1", username: "HashRider" } };
    }
    throw new Error(`unexpected rpc ${call.fn}`);
  });
  try {
    const store = new SupabaseStore(config);
    const { user, token } = await store.register("HashRider", "correct horse battery");
    assert.equal(user.username, "HashRider");
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(calls[0].args.p_token_hash, digest(token));
    assert.equal(calls[0].args.p_salt.length, 32);
    assert.equal(calls[0].args.p_password_hash.length, 128);
  } finally { restore(); }
});

test("supabase store login rejects bad passwords without leaking which field failed", async () => {
  const { restore } = stubFetch((call) => {
    if (call.fn === "cowboy_lookup_user") {
      return { body: { id: "u1", username: "HashRider", salt: "00".repeat(16), passwordHash: "11".repeat(64) } };
    }
    if (call.fn === "cowboy_create_session") return { status: 204 };
    throw new Error(`unexpected rpc ${call.fn}`);
  });
  try {
    const store = new SupabaseStore(config);
    await assert.rejects(store.login("HashRider", "wrong password!!"), (error: unknown) => {
      assert.ok(error instanceof AccountError);
      assert.equal(error.code, "invalid_credentials");
      assert.equal(error.status, 401);
      return true;
    });
  } finally { restore(); }
});

test("supabase store maps domain errors from Postgres exceptions", async () => {
  const cases: Array<[string, string, number]> = [
    ["unauthorized", "unauthorized", 401],
    ["username_taken", "username_taken", 409],
    ["request_replayed", "request_replayed", 409],
    ["duplicate_pick", "duplicate_pick", 409],
    ["event_locked", "event_locked", 409],
    ["pick_changed", "pick_changed", 409],
    ["ticket_unavailable", "ticket_unavailable", 409],
  ];
  for (const [sqlMessage, code, status] of cases) {
    const { restore } = stubFetch(() => rpcError(sqlMessage));
    try {
      const store = new SupabaseStore(config);
      await assert.rejects(store.getUser("a".repeat(64)), (error: unknown) => {
        assert.ok(error instanceof AccountError);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return true;
      });
    } finally { restore(); }
  }
});

test("supabase store treats transport failure and unknown errors as storage_unavailable", async () => {
  const { restore } = stubFetch(() => ({ status: 500, body: { message: "connection reset" } }));
  try {
    const store = new SupabaseStore(config);
    await assert.rejects(store.getUser("a".repeat(64)), (error: unknown) => {
      assert.ok(error instanceof AccountError);
      assert.equal((error as AccountError).code, "storage_unavailable");
      return true;
    });
  } finally { restore(); }
});

test("supabase store savePicks sends the atomic batch payload and returns stored tickets", async () => {
  const stored: StoredPick[] = [{
    id: "t1", eventId: "401810852", league: "nba", eventName: "A at B", selection: "A",
    side: "home", startsAt: "2030-01-01T00:00:00.000Z", createdAt: "2030-01-01T00:00:00.000Z",
    status: "open", settledAt: null, userId: "u1", requestId: "req-12345678", homeId: "h1", awayId: "a1",
  }];
  const { calls, restore } = stubFetch((call) => {
    if (call.fn === "cowboy_save_picks") return { body: stored };
    throw new Error(`unexpected rpc ${call.fn}`);
  });
  try {
    const store = new SupabaseStore(config);
    const token = "b".repeat(64);
    const result = await store.savePicks(token, [stored[0]]);
    assert.deepEqual(result, stored);
    assert.equal(calls[0].args.p_token_hash, digest(token));
    const picks = calls[0].args.p_picks as Array<Record<string, unknown>>;
    assert.equal(picks[0].requestId, "req-12345678");
    assert.equal(picks[0].eventId, "401810852");
  } finally { restore(); }
});

test("supabase store consensus maps aggregate rows through the shared builder", async () => {
  const { restore } = stubFetch((call) => {
    if (call.fn === "cowboy_consensus_rows") {
      return { body: [
        { userId: "u1", eventId: "e1", league: "nba", side: "home", status: "open", createdAt: "2030-01-01T00:00:00.000Z", updatedAt: null },
        { userId: "u2", eventId: "e1", league: "nba", side: "home", status: "open", createdAt: "2030-01-01T00:00:00.000Z", updatedAt: null },
      ] };
    }
    throw new Error(`unexpected rpc ${call.fn}`);
  });
  try {
    const store = new SupabaseStore(config);
    const consensus = await store.consensus();
    // Below CONSENSUS_MINIMUM the event must not be exposed.
    assert.deepEqual(consensus, {});
  } finally { restore(); }
});
