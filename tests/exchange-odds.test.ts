import test from "node:test";
import assert from "node:assert/strict";
import { createExchangeOddsClient } from "../app/lib/exchange-odds";

const GAME_FEED = {
  events: [
    {
      event_ticker: "KXNFLGAME-26NOV22ARIKC",
      title: "Arizona vs Kansas City",
      markets: [
        { ticker: "KC", yes_sub_title: "Kansas City", yes_bid_dollars: "0.9100", yes_ask_dollars: "0.9200", status: "active", expected_expiration_time: "2026-11-22T21:00:00Z" },
        { ticker: "ARI", yes_sub_title: "Arizona", yes_bid_dollars: "0.0800", yes_ask_dollars: "0.0900", status: "active", expected_expiration_time: "2026-11-22T21:00:00Z" },
      ],
    },
    {
      event_ticker: "KXNBAGAME-26NOV23LALBOS",
      title: "LA Lakers vs Boston Celtics",
      markets: [
        { ticker: "LAL", yes_sub_title: "LA Lakers", yes_bid_dollars: "0.4500", yes_ask_dollars: "0.4600", status: "active", expected_expiration_time: "2026-11-23T23:30:00Z" },
        { ticker: "BOS", yes_sub_title: "Boston Celtics", yes_bid_dollars: "0.5400", yes_ask_dollars: "0.5500", status: "active", expected_expiration_time: "2026-11-23T23:30:00Z" },
      ],
    },
  ],
};

// KC is a ~7.5-point favorite: "wins by over" probabilities cross 50% near 7.5.
const SPREAD_FEED = {
  events: [
    {
      event_ticker: "KXNFLSPREAD-26NOV22ARIKC",
      title: "Arizona vs Kansas City: Spread",
      markets: [
        { yes_sub_title: "Kansas City wins by over 4.5 points", floor_strike: 4.5, yes_bid_dollars: "0.7000", yes_ask_dollars: "0.7200", status: "active" },
        { yes_sub_title: "Kansas City wins by over 6.5 points", floor_strike: 6.5, yes_bid_dollars: "0.5200", yes_ask_dollars: "0.5400", status: "active" },
        { yes_sub_title: "Kansas City wins by over 8.5 points", floor_strike: 8.5, yes_bid_dollars: "0.3800", yes_ask_dollars: "0.4000", status: "active" },
        { yes_sub_title: "Arizona wins by over 4.5 points", floor_strike: 4.5, yes_bid_dollars: "0.1800", yes_ask_dollars: "0.2000", status: "active" },
        { yes_sub_title: "Arizona wins by over 6.5 points", floor_strike: 6.5, yes_bid_dollars: "0.1200", yes_ask_dollars: "0.1400", status: "active" },
        { yes_sub_title: "Arizona wins by over 8.5 points", floor_strike: 8.5, yes_bid_dollars: "0.0800", yes_ask_dollars: "0.1000", status: "active" },
      ],
    },
  ],
};

const TOTAL_FEED = {
  events: [
    {
      event_ticker: "KXNFLTOTAL-26NOV22ARIKC",
      title: "Arizona vs Kansas City: Total Points",
      markets: [
        { yes_sub_title: "Over 42.5 points", floor_strike: 42.5, yes_bid_dollars: "0.6200", yes_ask_dollars: "0.6400", status: "active" },
        { yes_sub_title: "Over 44.5 points", floor_strike: 44.5, yes_bid_dollars: "0.5000", yes_ask_dollars: "0.5200", status: "active" },
        { yes_sub_title: "Over 46.5 points", floor_strike: 46.5, yes_bid_dollars: "0.3800", yes_ask_dollars: "0.4000", status: "active" },
      ],
    },
  ],
};

function client() {
  const fetcher = async (url: string) => {
    assert.match(url, /api\.elections\.kalshi\.com/);
    const series = new URL(url).searchParams.get("series_ticker") ?? "";
    const payload = series.includes("SPREAD") ? SPREAD_FEED
      : series.includes("TOTAL") ? TOTAL_FEED : GAME_FEED;
    return new Response(JSON.stringify(payload), {
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

test("exchange odds extracts main spread and total lines from ladders", async () => {
  const odds = await client().forEvent(
    "nfl",
    "Kansas City Chiefs",
    "Arizona Cardinals",
    "2026-11-22T21:00:00Z",
  );
  assert.ok(odds);
  // KC is the favorite; its strike nearest 50% is 6.5 -> home -6.5.
  assert.equal(odds.spread, -6.5);
  assert.ok(odds.homeSpreadPrice !== null && odds.awaySpreadPrice !== null);
  // Total strike nearest 50% is 44.5.
  assert.equal(odds.total, 44.5);
  assert.ok(odds.overPrice !== null && odds.underPrice !== null);
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
