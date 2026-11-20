import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as getMatches } from "../app/api/showcase/matches/route";
import { GET as getMatchDetail } from "../app/api/showcase/matches/[slug]/route";
import { statPercentages } from "../app/lib/showcase-stats";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("showcase list drops unidentified fixtures and leaves missing competition unknown", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ matches: [
    { url: "/football/match/real-game/", home: " Home Team ", away: "Away Team", home_score: "2", away_score: "1" },
    { url: "/football/match/missing-home/", away: "Away Team" },
    { url: "/football/match/missing-away/", home: "Home Team" },
  ] });
  try {
    const response = await getMatches();
    const payload = await response.json();
    assert.equal(payload.matches.length, 1);
    assert.equal(payload.matches[0].home, "Home Team");
    assert.equal(payload.matches[0].away, "Away Team");
    assert.equal(payload.matches[0].competition, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("showcase detail rejects a source record without real team names", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ match: { away: "Away Team", home_score: "0", away_score: "0" } });
  try {
    const response = await getMatchDetail(new Request("https://example.test/api/showcase/matches/real-game"), {
      params: Promise.resolve({ slug: "real-game" }),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "match_unavailable" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("showcase detail leaves missing competition unknown instead of inventing one", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ match: { home: "Home Team", away: "Away Team", stats: [] } });
  try {
    const response = await getMatchDetail(new Request("https://example.test/api/showcase/matches/real-game"), {
      params: Promise.resolve({ slug: "real-game" }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.match.competition, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stat bars use source-backed values and omit empty or invalid comparisons", () => {
  assert.deepEqual(statPercentages({ home: 6, away: 2 }), { home: 75, away: 25 });
  assert.deepEqual(statPercentages({ home: 25 }), null);
  assert.deepEqual(statPercentages({ home: 0, away: 0 }), null);
  assert.deepEqual(statPercentages({ home: "not available", away: 3 }), null);
  assert.deepEqual(statPercentages({ home_pct: 63 }), { home: 63, away: 37 });
  assert.deepEqual(statPercentages({ away_pct: 70 }), { home: 30, away: 70 });
});
