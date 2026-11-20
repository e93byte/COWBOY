import assert from "node:assert/strict";
import { test } from "node:test";
import { createMarketReferenceClient } from "../app/lib/market-reference";

const oddsPayload = [
  {
    provider: { id: "200", name: "DraftKings - Live Odds" },
    homeTeamOdds: { moneyLine: -120 },
    awayTeamOdds: { moneyLine: 100 },
  },
  {
    provider: { id: "100", name: "DraftKings" },
    homeTeamOdds: { moneyLine: -150 },
    awayTeamOdds: { moneyLine: 130 },
    drawOdds: { moneyLine: 240 },
  },
];

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("market reference normalizes American odds into vig-free implied probabilities", async () => {
  const client = createMarketReferenceClient({
    fetch: async () => jsonResponse(oddsPayload),
    now: () => Date.parse("2030-01-01T00:00:00Z"),
  });
  const market = await client.get("nba", "401910002");
  assert.ok(market);
  assert.equal(market.provider, "DraftKings");
  // -150 → .6, +130 → .4348, +240 → .2941 raw; normalized sums to 1.
  const total = market.home + market.away + (market.draw ?? 0);
  assert.ok(Math.abs(total - 1) < 0.001, `expected probabilities to sum to 1, got ${total}`);
  assert.ok(market.home > market.away && market.home > (market.draw ?? 0));
  assert.equal(market.draw !== null, true);
});

test("market reference does not invent a bookmaker name when source metadata is missing", async () => {
  const client = createMarketReferenceClient({
    fetch: async () => jsonResponse([{
      homeTeamOdds: { moneyLine: -110 },
      awayTeamOdds: { moneyLine: -110 },
    }]),
  });
  const market = await client.get("nba", "401910002");
  assert.equal(market?.provider, "Provider unavailable");
});

test("market reference omits draw for two-way sports and rejects unusable payloads", async () => {
  const twoWay = createMarketReferenceClient({
    fetch: async () => jsonResponse([{
      provider: { id: "100", name: "DraftKings" },
      homeTeamOdds: { moneyLine: -110 },
      awayTeamOdds: { moneyLine: -110 },
    }]),
    now: () => Date.now(),
  });
  const market = await twoWay.get("nfl", "401547999");
  assert.ok(market);
  assert.equal(market.draw, null);
  assert.ok(Math.abs(market.home + market.away - 1) < 0.001);

  const empty = createMarketReferenceClient({ fetch: async () => jsonResponse([]), now: () => Date.now() });
  assert.equal(await empty.get("nba", "401910002"), null);

  const html = createMarketReferenceClient({
    fetch: async () => new Response("<html>blocked</html>", { headers: { "content-type": "text/html" } }),
    now: () => Date.now(),
  });
  assert.equal(await html.get("nba", "401910002"), null);
});

test("market reference caches successes, coalesces requests, and backs off failures", async () => {
  let calls = 0;
  let fail = true;
  let current = Date.now();
  const client = createMarketReferenceClient({
    fetch: async () => {
      calls += 1;
      if (fail) return new Response("nope", { status: 503 });
      return jsonResponse([{
        provider: { id: "100", name: "DraftKings" },
        homeTeamOdds: { moneyLine: -200 },
        awayTeamOdds: { moneyLine: 170 },
      }]);
    },
    now: () => current,
  });
  assert.equal(await client.get("mlb", "745804"), null);
  assert.equal(await client.get("mlb", "745804"), null);
  assert.equal(calls, 1, "failures must be cached briefly");
  current += 61_000;
  fail = false;
  const market = await client.get("mlb", "745804");
  assert.ok(market);
  const before = calls;
  await client.get("mlb", "745804");
  assert.equal(calls, before, "successes must be cached");
});

test("market reference rejects invalid leagues and event ids without fetching", async () => {
  let calls = 0;
  const client = createMarketReferenceClient({
    fetch: async () => { calls += 1; return jsonResponse([]); },
    now: () => Date.now(),
  });
  assert.equal(await client.get("pga", "123"), null);
  assert.equal(await client.get("nba", "not-an-id"), null);
  assert.equal(await client.get("nope", "123"), null);
  assert.equal(calls, 0);
});

test("market reference tracks first-seen probabilities as the open baseline", async () => {
  let current = Date.now();
  let line = -150;
  const client = createMarketReferenceClient({
    fetch: async () => jsonResponse([{
      provider: { id: "100", name: "DraftKings" },
      homeTeamOdds: { moneyLine: line },
      awayTeamOdds: { moneyLine: 130 },
    }]),
    now: () => current,
  });
  const first = await client.get("nba", "401910002");
  assert.ok(first?.open);
  assert.equal(first.open.home, first.home, "first reading becomes its own baseline");
  current += 11 * 60_000;
  line = -110;
  const moved = await client.get("nba", "401910002");
  assert.ok(moved);
  assert.ok(moved.open && moved.open.home > moved.home, "open keeps the earlier baseline after movement");
});
