import test from "node:test";
import assert from "node:assert/strict";
import { createExchangeOddsClient } from "../app/lib/exchange-odds";

const FEED = {
  events: [
    {
      event_ticker: "KXNFLGAME-26NOV22ARIKC",
      title: "Arizona vs Kansas City",
      markets: [
        {
          ticker: "KXNFLGAME-26NOV22ARIKC-KC",
          yes_sub_title: "Kansas City",
          yes_bid_dollars: "0.9100",
          yes_ask_dollars: "0.9200",
          status: "active",
          expected_expiration_time: "2026-11-22T21:00:00Z",
        },
        {
          ticker: "KXNFLGAME-26NOV22ARIKC-ARI",
          yes_sub_title: "Arizona",
          yes_bid_dollars: "0.0800",
          yes_ask_dollars: "0.0900",
          status: "active",
          expected_expiration_time: "2026-11-22T21:00:00Z",
        },
      ],
    },
    {
      event_ticker: "KXNBAGAME-26NOV23LALBOS",
      title: "LA Lakers vs Boston Celtics",
      markets: [
        {
          ticker: "KXNBAGAME-26NOV23LALBOS-LAL",
          yes_sub_title: "LA Lakers",
          yes_bid_dollars: "0.4500",
          yes_ask_dollars: "0.4600",
          status: "active",
          expected_expiration_time: "2026-11-23T23:30:00Z",
        },
        {
          ticker: "KXNBAGAME-26NOV23LALBOS-BOS",
          yes_sub_title: "Boston Celtics",
          yes_bid_dollars: "0.5400",
          yes_ask_dollars: "0.5500",
          status: "active",
          expected_expiration_time: "2026-11-23T23:30:00Z",
        },
      ],
    },
  ],
};

function client() {
  const fetcher = async (url: string) => {
    assert.match(url, /api\.elections\.kalshi\.com/);
    return new Response(JSON.stringify(FEED), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return createExchangeOddsClient({ fetch: fetcher as typeof fetch });
}

test("exchange odds converts Kalshi YES prices to American odds for a matched game", async () => {
  const odds = await client().forEvent(
    "nfl",
    "Kansas City Chiefs",
    "Arizona Cardinals",
    "2026-11-22T21:00:00Z",
  );
  assert.ok(odds);
  // KC midpoint 0.915 -> about -1075; ARI midpoint 0.085 -> about +1076.
  assert.ok(odds.home !== null && odds.home < -500, `home ${odds.home}`);
  assert.ok(odds.away !== null && odds.away > 500, `away ${odds.away}`);
});

test("exchange odds rejects ambiguous or unmatched games", async () => {
  const c = client();
  // No Kalshi game for this matchup/date.
  assert.equal(await c.forEvent("nfl", "Buffalo Bills", "Miami Dolphins", "2026-11-22T21:00:00Z"), null);
  // Date outside the 72h window.
  assert.equal(await c.forEvent("nfl", "Kansas City Chiefs", "Arizona Cardinals", "2026-12-01T21:00:00Z"), null);
  // League without a Kalshi series.
  assert.equal(await c.forEvent("atp", "Player A", "Player B", "2026-11-22T21:00:00Z"), null);
});

test("exchange odds handles fetch failure without throwing", async () => {
  const c = createExchangeOddsClient({
    fetch: (async () => new Response("nope", { status: 500 })) as typeof fetch,
  });
  assert.equal(await c.forEvent("nba", "LA Lakers", "Boston Celtics", "2026-11-23T23:30:00Z"), null);
});
