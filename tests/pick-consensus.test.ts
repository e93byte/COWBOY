import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AccountStore, type StoredPick } from "../app/lib/account-store";
import { PickService } from "../app/lib/pick-service";
import type { LiveEvent } from "../app/lib/live-sports";
import { buildPickConsensus, consensusKey, consensusPercent, CONSENSUS_MINIMUM } from "../app/lib/pick-consensus";
import type { PickSide } from "../app/lib/pick-outcomes";

const eventTime = Date.parse("2030-01-01T12:00:00.000Z");
const iso = (offsetMs = 0) => new Date(eventTime + offsetMs).toISOString();

function storedPick(overrides: Partial<StoredPick> = {}): StoredPick {
  return {
    id: "ticket-1", userId: "user-1", requestId: "request-1",
    eventId: "401234567", league: "nba", eventName: "Away at Home", selection: "Home Team",
    side: "home", startsAt: iso(3600000), createdAt: iso(), status: "open", settledAt: null,
    homeId: "1", awayId: "2",
    ...overrides,
  };
}

function event(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: "401234567", league: "nba", sport: "basketball", leagueName: "NBA", name: "Away at Home",
    startsAt: iso(3600000), status: "scheduled", statusText: "Scheduled",
    clock: null, period: null,
    home: { id: "1", name: "Home Team", shortName: "HOME", score: null },
    away: { id: "2", name: "Away Team", shortName: "AWAY", score: null },
    winner: null, completed: false,
    ...overrides,
  };
}

async function fixture<T>(run: (store: AccountStore, dir: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(await realpath(tmpdir()), "cowboy-consensus-"));
  try { return await run(new AccountStore({ directory: dir }), dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("consensus counts only active picks and hides events below the privacy threshold", () => {
  const picks = [
    ...Array.from({ length: CONSENSUS_MINIMUM - 1 }, (_, index) => storedPick({ id: `t${index}`, requestId: `r${index}` })),
    storedPick({ id: "cancelled", requestId: "rc", status: "cancelled", settledAt: iso() }),
    storedPick({ id: "voided", requestId: "rv", status: "void", settledAt: iso() }),
  ];
  // CONSENSUS_MINIMUM - 1 active picks is not enough even before exclusions.
  assert.deepEqual(buildPickConsensus(picks), {});

  const enough = [
    ...Array.from({ length: CONSENSUS_MINIMUM }, (_, index) => storedPick({
      id: `a${index}`, requestId: `ra${index}`,
      side: index < 3 ? "home" : "away",
    })),
    storedPick({ id: "lost", requestId: "rl", status: "lost", settledAt: iso(), side: "draw" }),
    storedPick({ id: "won", requestId: "rw", status: "won", settledAt: iso(), side: "draw" }),
    storedPick({ id: "cancelled", requestId: "rc", status: "cancelled", settledAt: iso() }),
    storedPick({ id: "voided", requestId: "rv", status: "void", settledAt: iso() }),
  ];
  const consensus = buildPickConsensus(enough);
  assert.deepEqual(consensus[consensusKey("nba", "401234567")], { home: 3, away: 2, draw: 2, total: 7 });
  // Other events stay absent.
  assert.equal(Object.keys(consensus).length, 1);
});

test("consensusPercent reports side share and never fabricates data", () => {
  const entry = { home: 3, away: 2, draw: 0, total: 5 };
  assert.equal(consensusPercent(entry, "home"), 60);
  assert.equal(consensusPercent(entry, "away"), 40);
  assert.equal(consensusPercent(entry, "draw"), 0);
  assert.equal(consensusPercent({ home: 1, away: 0, draw: 0, total: 1 }, "home"), null);
  assert.equal(consensusPercent(undefined, "home"), null);
});

test("PickService.consensus aggregates anonymous counts across users without exposing identities", async () => {
  await fixture(async (store) => {
    const service = new PickService({ store, getEvent: async () => event(), now: () => eventTime });
    const sides: PickSide[] = ["home", "home", "home", "away", "away"];
    const tokens: string[] = [];
    for (const [index, side] of sides.entries()) {
      const registered = await store.register(`picker${index}`, "correct-horse-local-password");
      tokens.push(registered.token);
      await service.submit(registered.token, {
        eventId: "401234567", league: "nba", side,
        requestId: `request-${index}`,
      });
    }
    const consensus = await service.consensus();
    const entry = consensus["nba:401234567"];
    assert.deepEqual(entry, { home: 3, away: 2, draw: 0, total: 5 });
    const serialized = JSON.stringify(consensus);
    for (const token of tokens) assert.ok(!serialized.includes(token));
    for (const userIdGuess of ["picker0", "user"]) assert.ok(!serialized.includes(userIdGuess));
  });
});

test("consensus drops cancelled picks and reflects the latest edited side", async () => {
  await fixture(async (store) => {
    const service = new PickService({ store, getEvent: async () => event(), now: () => eventTime });
    for (let index = 0; index < CONSENSUS_MINIMUM; index++) {
      const registered = await store.register(`editor${index}`, "correct-horse-local-password");
      const ticket = await service.submit(registered.token, {
        eventId: "401234567", league: "nba", side: "home", requestId: `edit-request-${index}`,
      });
      if (index === 0) {
        const edited = await service.edit(registered.token, { id: ticket.id, side: "away", revision: 0 });
        assert.equal(edited.side, "away");
      }
      if (index === 1) await service.cancel(registered.token, ticket.id);
    }
    // 5 submitted, 1 cancelled, 1 edited home->away: 3 home, 1 away = 4 active, below threshold.
    assert.deepEqual(await service.consensus(), {});
  });
});

test("consensus endpoint returns counts without requiring a session", async () => {
  await fixture(async (store) => {
    const service = new PickService({ store, getEvent: async () => event(), now: () => eventTime });
    for (let index = 0; index < CONSENSUS_MINIMUM; index++) {
      const registered = await store.register(`anon${index}`, "correct-horse-local-password");
      await service.submit(registered.token, {
        eventId: "401234567", league: "nba", side: "home", requestId: `anon-request-${index}`,
      });
    }
    const { createPickHandlers } = await import("../app/api/picks/handlers");
    const handlers = createPickHandlers({ service });
    const response = await handlers.CONSENSUS();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /public/);
    const body = await response.json() as { consensus: Record<string, { total: number }> };
    assert.equal(body.consensus["nba:401234567"].total, CONSENSUS_MINIMUM);
  });
});
