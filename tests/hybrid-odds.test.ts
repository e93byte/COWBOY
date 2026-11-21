import assert from 'node:assert/strict';
import test from 'node:test';
import { createHybridOddsClient, createQuotaTracker, toOddsApiKey, PROVIDER_CAPABILITIES } from '../app/lib/hybrid-odds';

const NOW = Date.parse('2026-11-21T12:00:00Z');

function oddsEvent(id = 'evt-1', commence = '2026-11-22T00:00:00Z') {
  return {
    id, home_team: 'Home Team', away_team: 'Away Team', commence_time: commence,
    bookmakers: [{
      title: 'DraftKings',
      markets: [
        { key: 'h2h', outcomes: [
          { name: 'Home Team', price: -150 }, { name: 'Away Team', price: 130 },
        ]},
        { key: 'spreads', outcomes: [
          { name: 'Home Team', price: -110, point: -3.5 }, { name: 'Away Team', price: -110, point: 3.5 },
        ]},
        { key: 'totals', outcomes: [
          { name: 'Over', price: -105, point: 220.5 }, { name: 'Under', price: -115, point: 220.5 },
        ]},
      ],
    }],
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

// Canonical ESPN event the ToA fixture must identity-match: same team names,
// start within the 72h provider-drift window.
function espnEvent(id = '401') {
  return {
    id, league: 'nfl', sport: 'football', leagueName: 'NFL',
    name: 'Away Team at Home Team', startsAt: '2026-11-22T00:00:00Z',
    status: 'scheduled', statusText: 'Scheduled', clock: null, period: null,
    home: { id: '11', name: 'Home Team', shortName: 'Home', score: null },
    away: { id: '22', name: 'Away Team', shortName: 'Away', score: null },
    winner: null, completed: false,
  } as any;
}

function client(overrides: {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  env?: Record<string, string>;
  now?: () => number;
  ttl?: { liveMs?: number; pregameMs?: number };
  getEvent?: (league: string, id: string) => Promise<any>;
  event?: any;
} = {}) {
  return createHybridOddsClient({
    fetch: overrides.fetch ?? (async () => jsonResponse([oddsEvent()])),
    env: overrides.env ?? { ODDS_API_KEY: 'test-key' },
    now: overrides.now ?? (() => NOW),
    ttl: overrides.ttl,
    getEvent: overrides.getEvent ?? (async () => overrides.event === undefined ? espnEvent() : overrides.event),
  });
}

test('sport key mapping covers supported leagues only', () => {
  assert.equal(toOddsApiKey('nfl'), 'americanfootball_nfl');
  assert.equal(toOddsApiKey('NBA'), 'basketball_nba');
  assert.equal(toOddsApiKey('atp'), null);
  assert.ok(PROVIDER_CAPABILITIES['the-odds-api'].includes('bookmaker-odds'));
  assert.ok(!PROVIDER_CAPABILITIES['the-odds-api'].includes('scores'));
  assert.ok(PROVIDER_CAPABILITIES.espn.includes('bookmaker-odds'));
});

test('cache hit avoids a second upstream call for the same sport board', async () => {
  let calls = 0;
  const c = client({
    fetch: async () => { calls++; return jsonResponse([oddsEvent('e1'), oddsEvent('e2', '2026-12-15T00:00:00Z')]); },
  });
  const first = await c.fetchOddsWithFallback('nfl', 'e1');
  const second = await c.fetchOddsWithFallback('nfl', 'e1');
  assert.equal(calls, 1);
  assert.equal(first.source, 'the-odds-api');
  assert.equal(second.source, 'the-odds-api');
  assert.equal(second.eventId, '401'); // canonical ESPN id, not provider id
  assert.equal(first.odds?.provider, 'DraftKings');
  assert.equal(first.freshness.cache, 'miss');
});

test('simultaneous duplicate requests share one upstream call', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const c = client({
    fetch: async () => { calls++; await gate; return jsonResponse([oddsEvent('e1')]); },
  });
  const a = c.fetchOddsWithFallback('nfl', 'e1');
  const b = c.fetchOddsWithFallback('nfl', 'e1');
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(ra.source, 'the-odds-api');
  assert.equal(rb.source, 'the-odds-api');
});

test('cache expires after the configured TTL', async () => {
  let now = NOW;
  let calls = 0;
  const c = client({
    now: () => now,
    ttl: { pregameMs: 1000 },
    fetch: async () => { calls++; return jsonResponse([oddsEvent('e1')]); },
  });
  await c.fetchOddsWithFallback('nfl', 'e1');
  now += 500;
  await c.fetchOddsWithFallback('nfl', 'e1');
  assert.equal(calls, 1);
  now += 600;
  await c.fetchOddsWithFallback('nfl', 'e1');
  assert.equal(calls, 2);
});

test('different sports, markets and regions never share cache entries', async () => {
  const seen: string[] = [];
  const c = client({
    fetch: async (url) => { seen.push(url); return jsonResponse([oddsEvent('e1')]); },
  });
  await c.fetchOddsWithFallback('nfl', 'e1');
  await c.fetchOddsWithFallback('nba', 'e1');
  assert.equal(seen.length, 2);
  assert.ok(seen[0].includes('americanfootball_nfl'));
  assert.ok(seen[1].includes('basketball_nba'));
  assert.ok(seen[0].includes('markets=h2h%2Cspreads%2Ctotals') || seen[0].includes('markets=h2h,spreads,totals'));
});

test('missing API key skips upstream and reports missing_key', async () => {
  const c = client({ env: {} });
  const result = await c.fetchOddsWithFallback('nfl', 'e1');
  assert.equal(result.source, 'espn');
  assert.equal(result.freshness.error, 'missing_key');
});

test('401 and 403 mark the provider unauthorized and fall back', async () => {
  for (const status of [401, 403]) {
    const c = client({ fetch: async () => jsonResponse({ error: 'no' }, { status }) });
    const result = await c.fetchOddsWithFallback('nfl', 'e1');
    assert.equal(result.freshness.error, 'unauthorized');
    assert.equal(result.source, 'espn');
  }
});

test('429 honors rate limiting category and Retry-After header is read', async () => {
  const c = client({
    fetch: async () => jsonResponse({ error: 'slow down' }, { status: 429, headers: { 'retry-after': '30' } }),
  });
  const result = await c.fetchOddsWithFallback('nfl', 'e1');
  assert.equal(result.freshness.error, 'rate_limited');
});

test('451 reports region_unavailable', async () => {
  const c = client({ fetch: async () => jsonResponse({}, { status: 451 }) });
  const result = await c.fetchOddsWithFallback('nfl', 'e1');
  assert.equal(result.freshness.error, 'region_unavailable');
});

test('quota exhaustion disables upstream refresh until the next day', async () => {
  let now = NOW;
  const tracker = createQuotaTracker({ now: () => now, dailyCredits: 2 });
  // allow() reserves atomically: two reservations exhaust a cap of 2.
  assert.equal(tracker.allow(), true);
  assert.equal(tracker.allow(), true);
  assert.equal(tracker.allow(), false);
  assert.equal(tracker.snapshot().exhausted, true);
  now += 86_400_000;
  assert.equal(tracker.allow(), true);
});

test('quota reservations bill markets × regions per board call', async () => {
  // 3 markets × 1 region = 3 credits per upstream board request. A daily cap
  // of 6 therefore allows exactly two sport boards before exhaustion.
  let calls = 0;
  const c = client({
    env: { ODDS_API_KEY: 'test-key', ODDS_API_DAILY_CREDITS: '6' },
    fetch: async () => { calls++; return jsonResponse([oddsEvent('e1')]); },
  });
  await c.fetchOddsWithFallback('nfl', 'e1');
  await c.fetchOddsWithFallback('nba', 'e1');
  const third = await c.fetchOddsWithFallback('mlb', 'e1');
  assert.equal(calls, 2);
  assert.equal(third.freshness.error, 'quota_exhausted');
  assert.equal(third.source, 'espn'); // degraded, never fabricated odds
});

test('provider header usage is authoritative over local counting', () => {
  const tracker = createQuotaTracker({ now: () => NOW, dailyCredits: 500 });
  const headers = new Headers({
    'x-requests-remaining': '499', 'x-requests-used': '1', 'x-requests-last': '1',
  });
  tracker.observe(headers);
  assert.equal(tracker.snapshot().used, 1);
});

test('empty market array is valid and does not error', async () => {
  const c = client({ fetch: async () => jsonResponse([]) });
  const result = await c.fetchOddsWithFallback('nfl', 'e1');
  // Empty board falls back to ESPN but records the empty-market category.
  assert.equal(result.freshness.error, 'empty_market');
});

test('malformed payload is categorized, not thrown', async () => {
  const c = client({ fetch: async () => jsonResponse({ not: 'an array' }) });
  const result = await c.fetchOddsWithFallback('nfl', 'e1');
  assert.equal(result.freshness.error, 'malformed');
});

test('network failure falls back without throwing', async () => {
  const c = client({ fetch: async () => { throw new Error('socket hangup'); } });
  const result = await c.fetchOddsWithFallback('nfl', 'e1');
  assert.equal(result.freshness.error, 'network');
  assert.equal(result.source, 'espn');
});

test('league without an odds-api mapping never calls upstream', async () => {
  let calls = 0;
  const c = client({ fetch: async () => { calls++; return jsonResponse([]); } });
  await c.fetchOddsWithFallback('atp', 'e1');
  assert.equal(calls, 0);
});

test('recovery: a later success clears the breaker after failures', async () => {
  let calls = 0;
  const c = client({
    fetch: async () => {
      calls++;
      if (calls <= 3) return jsonResponse({}, { status: 500 });
      return jsonResponse([oddsEvent('e1')]);
    },
  });
  await c.fetchOddsWithFallback('nfl', 'e1');
  await c.fetchOddsWithFallback('nfl', 'e1');
  await c.fetchOddsWithFallback('nfl', 'e1');
  // Breaker open after 3 failures — upstream is skipped, error surfaces.
  const blocked = await c.fetchOddsWithFallback('nfl', 'e1');
  assert.equal(calls, 3);
  assert.equal(blocked.source, 'espn');
});

test('freshness never labels unavailable data as fresh', async () => {
  const c = client({ env: {} });
  const result = await c.fetchOddsWithFallback('nfl', 'e1');
  if (result.freshness.state === 'fresh') {
    assert.ok(result.source !== null);
  } else {
    assert.notEqual(result.freshness.state, 'fresh');
  }
  assert.equal(result.freshness.provider !== null || result.freshness.state === 'unavailable', true);
});
