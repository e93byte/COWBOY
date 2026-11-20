import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateCombinedOdds,
  calculatePotentialPayout,
  validateParlayLegs,
  checkCorrelation,
  settleParlay,
  generateParlayId,
  type ParlayLeg,
  type ParlayTicket,
  type ParlayInput,
} from "../app/lib/parlay";
import type { PickMarket, PickSide } from "../app/lib/pick-outcomes";

function makeLeg(overrides: Partial<ParlayLeg> = {}): ParlayLeg {
  return {
    eventId: "1",
    league: "nba",
    market: "moneyline",
    side: "home",
    line: null,
    odds: -110,
    eventName: "Test Game",
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    sport: "basketball",
    ...overrides,
  };
}

test("calculateCombinedOdds: two -110 legs returns +264", () => {
  const legs = [makeLeg({ odds: -110 }), makeLeg({ odds: -110, eventId: "2" })];
  const combined = calculateCombinedOdds(legs);
  assert.equal(combined, 264);
});

test("calculateCombinedOdds: three legs with mixed odds", () => {
  const legs = [
    makeLeg({ odds: -150 }),
    makeLeg({ odds: +200, eventId: "2" }),
    makeLeg({ odds: -110, eventId: "3" }),
  ];
  const combined = calculateCombinedOdds(legs);
  assert.equal(combined, 855);
});

test("calculatePotentialPayout: $100 at +264 returns $364", () => {
  const payout = calculatePotentialPayout(100, 264);
  assert.equal(payout, 364);
});

test("calculatePotentialPayout: $50 at -110 returns $95.45", () => {
  const payout = calculatePotentialPayout(50, -110);
  assert.equal(payout, 95.45);
});

test("validateParlayLegs: valid parlay returns valid", () => {
  const legs = [makeLeg(), makeLeg({ eventId: "2" })];
  const result = validateParlayLegs(legs);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateParlayLegs: single leg fails", () => {
  const legs = [makeLeg()];
  const result = validateParlayLegs(legs);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Parlay requires at least 2 legs"));
});

test("validateParlayLegs: 11 legs fails", () => {
  const legs = Array.from({ length: 11 }, (_, i) => makeLeg({ eventId: String(i) }));
  const result = validateParlayLegs(legs);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Parlay cannot exceed 10 legs"));
});

test("validateParlayLegs: duplicate event+market fails", () => {
  const legs = [makeLeg({ eventId: "1", market: "moneyline" }), makeLeg({ eventId: "1", market: "moneyline" })];
  const result = validateParlayLegs(legs);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Duplicate leg (same event and market)"));
});

test("validateParlayLegs: past event fails", () => {
  const legs = [
    makeLeg({ startsAt: new Date(Date.now() - 3600000).toISOString() }),
    makeLeg({ eventId: "2" }),
  ];
  const result = validateParlayLegs(legs);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("has already started")));
});

test("checkCorrelation: unrelated legs allowed", () => {
  const legs = [
    makeLeg({ eventId: "1", league: "nba" }),
    makeLeg({ eventId: "2", league: "nfl" }),
  ];
  const result = checkCorrelation(legs);
  assert.equal(result.allowed, true);
  assert.equal(result.correlatedGroups.length, 0);
});

test("checkCorrelation: opposing sides on same game blocked", () => {
  const legs = [
    makeLeg({ eventId: "1", league: "nba", market: "moneyline", side: "home" }),
    makeLeg({ eventId: "1", league: "nba", market: "moneyline", side: "away" }),
  ];
  const result = checkCorrelation(legs);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "Opposing sides on same game/market");
  assert.equal(result.correlatedGroups.length, 1);
});

test("checkCorrelation: same team different markets flagged but allowed", () => {
  const legs = [
    makeLeg({ eventId: "1", league: "nba", market: "moneyline", side: "home" }),
    makeLeg({ eventId: "1", league: "nba", market: "spread", side: "home" }),
  ];
  const result = checkCorrelation(legs);
  assert.equal(result.allowed, true);
  assert.equal(result.correlatedGroups.length, 1);
  assert.equal(result.correlatedGroups[0].reason, "Same team across different markets (SGP correlation)");
});

test("checkCorrelation: duplicate selection blocked", () => {
  const legs = [
    makeLeg({ eventId: "1", league: "nba", market: "moneyline", side: "home" }),
    makeLeg({ eventId: "1", league: "nba", market: "moneyline", side: "home" }),
  ];
  const result = checkCorrelation(legs);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "Duplicate selection");
});

test("checkCorrelation: over/under on same game blocked", () => {
  const legs = [
    makeLeg({ eventId: "1", league: "nba", market: "total", side: "over" }),
    makeLeg({ eventId: "1", league: "nba", market: "total", side: "under" }),
  ];
  const result = checkCorrelation(legs);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "Opposing sides on same game/market");
});

test("settleParlay: all won returns won", () => {
  const ticket: ParlayTicket = {
    id: "p1",
    legs: [makeLeg({ eventId: "1" }), makeLeg({ eventId: "2" })],
    combinedOdds: 264,
    stake: 100,
    potentialPayout: 364,
    status: "open",
    createdAt: new Date().toISOString(),
    settledAt: null,
    entryId: "p1",
    userId: "u1",
    requestId: "req1",
  };
  const results = new Map<string, "won" | "lost" | "void">();
  results.set("nba:1:moneyline:home", "won");
  results.set("nba:2:moneyline:home", "won");
  const outcome = settleParlay(ticket, results);
  assert.equal(outcome, "won");
});

test("settleParlay: any lost returns lost", () => {
  const ticket: ParlayTicket = {
    id: "p1",
    legs: [makeLeg({ eventId: "1" }), makeLeg({ eventId: "2" })],
    combinedOdds: 264,
    stake: 100,
    potentialPayout: 364,
    status: "open",
    createdAt: new Date().toISOString(),
    settledAt: null,
    entryId: "p1",
    userId: "u1",
    requestId: "req1",
  };
  const results = new Map<string, "won" | "lost" | "void">();
  results.set("nba:1:moneyline:home", "won");
  results.set("nba:2:moneyline:home", "lost");
  const outcome = settleParlay(ticket, results);
  assert.equal(outcome, "lost");
});

test("settleParlay: void leg returns void if no losses", () => {
  const ticket: ParlayTicket = {
    id: "p1",
    legs: [makeLeg({ eventId: "1" }), makeLeg({ eventId: "2" })],
    combinedOdds: 264,
    stake: 100,
    potentialPayout: 364,
    status: "open",
    createdAt: new Date().toISOString(),
    settledAt: null,
    entryId: "p1",
    userId: "u1",
    requestId: "req1",
  };
  const results = new Map<string, "won" | "lost" | "void">();
  results.set("nba:1:moneyline:home", "won");
  results.set("nba:2:moneyline:home", "void");
  const outcome = settleParlay(ticket, results);
  assert.equal(outcome, "void");
});

test("generateParlayId: produces unique IDs", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    ids.add(generateParlayId());
  }
  assert.equal(ids.size, 100);
  for (const id of ids) {
    assert.match(id, /^parlay_\d+_[a-z0-9]+$/);
  }
});

// ParlayService tests
test("ParlayService: list returns empty for new user", async () => {
  const { AccountStore } = await import("../app/lib/account-store");
  const { ParlayService } = await import("../app/lib/parlay-service");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");

  const dir = await mkdtemp(join(await resolve(tmpdir()), "cowboy-parlay-"));
  try {
    const store = new AccountStore({ directory: dir });
    const registered = await store.register("ServiceUser", "password123");
    const service = new ParlayService({
      store,
      getEvent: async () => null,
      now: Date.now,
    });
    const parlays = await service.list(registered.token);
    assert.deepEqual(parlays, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ParlayService: submit creates parlay and list returns it", async () => {
  const { AccountStore } = await import("../app/lib/account-store");
  const { ParlayService } = await import("../app/lib/parlay-service");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");

  const dir = await mkdtemp(join(await resolve(tmpdir()), "cowboy-parlay-"));
  try {
    const store = new AccountStore({ directory: dir });
    const registered = await store.register("SubmitUser", "password123");
    const service = new ParlayService({
      store,
      getEvent: async (league, eventId) => ({
        id: eventId,
        league,
        sport: "basketball",
        leagueName: "NBA",
        name: "Test Game",
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        status: "scheduled",
        statusText: "Scheduled",
        clock: null,
        period: null,
        home: { id: "1", name: "Home", shortName: "HOME", score: null },
        away: { id: "2", name: "Away", shortName: "AWAY", score: null },
        winner: null,
        completed: false,
      }),
      now: Date.now,
    });
    const input: ParlayInput = {
      legs: [
        { eventId: "1", league: "nba", market: "moneyline" as PickMarket, side: "home" as PickSide, line: null, requestId: "req1" },
        { eventId: "2", league: "nba", market: "moneyline" as PickMarket, side: "away" as PickSide, line: null, requestId: "req2" },
      ],
    };
    const parlay = await service.submit(registered.token, input);
    assert.equal(parlay.legs.length, 2);
    assert.equal(parlay.status, "open");

    const listed = await service.list(registered.token);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, parlay.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ParlayService: submit rejects opposing sides on same game/market", async () => {
  const { AccountStore } = await import("../app/lib/account-store");
  const { ParlayService } = await import("../app/lib/parlay-service");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");

  const dir = await mkdtemp(join(await resolve(tmpdir()), "cowboy-parlay-"));
  try {
    const store = new AccountStore({ directory: dir });
    const registered = await store.register("CorrUser", "password123");
    const service = new ParlayService({
      store,
      getEvent: async (league, eventId) => ({
        id: eventId,
        league,
        sport: "basketball",
        leagueName: "NBA",
        name: "Test Game",
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        status: "scheduled",
        statusText: "Scheduled",
        clock: null,
        period: null,
        home: { id: "1", name: "Home", shortName: "HOME", score: null },
        away: { id: "2", name: "Away", shortName: "AWAY", score: null },
        winner: null,
        completed: false,
      }),
      now: Date.now,
    });
    // Opposing sides on same game/market - caught by validation as duplicate event+market
    const input: ParlayInput = {
      legs: [
        { eventId: "1", league: "nba", market: "moneyline" as PickMarket, side: "home" as PickSide, line: null, requestId: "req1" },
        { eventId: "1", league: "nba", market: "moneyline" as PickMarket, side: "away" as PickSide, line: null, requestId: "req2" },
      ],
    };
    await assert.rejects(service.submit(registered.token, input), (err) => {
      return err instanceof Error && err.message.includes("Duplicate leg");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ParlayService: submit rejects started event", async () => {
  const { AccountStore } = await import("../app/lib/account-store");
  const { ParlayService } = await import("../app/lib/parlay-service");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");

  const dir = await mkdtemp(join(await resolve(tmpdir()), "cowboy-parlay-"));
  try {
    const store = new AccountStore({ directory: dir });
    const registered = await store.register("StartedUser", "password123");
    const service = new ParlayService({
      store,
      getEvent: async (league, eventId) => ({
        id: eventId,
        league,
        sport: "basketball",
        leagueName: "NBA",
        name: "Test Game",
        startsAt: new Date(Date.now() - 3600000).toISOString(),
        status: "live",
        statusText: "Live",
        clock: "10:00",
        period: 2,
        home: { id: "1", name: "Home", shortName: "HOME", score: 50 },
        away: { id: "2", name: "Away", shortName: "AWAY", score: 45 },
        winner: null,
        completed: false,
      }),
      now: Date.now,
    });
    const input: ParlayInput = {
      legs: [
        { eventId: "1", league: "nba", market: "moneyline" as PickMarket, side: "home" as PickSide, line: null, requestId: "req1" },
        { eventId: "2", league: "nba", market: "moneyline" as PickMarket, side: "away" as PickSide, line: null, requestId: "req2" },
      ],
    };
    await assert.rejects(service.submit(registered.token, input), (err) => {
      return err instanceof Error && err.message.includes("started");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});