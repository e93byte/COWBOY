import assert from 'node:assert/strict';
import test from 'node:test';
import { createHybridOddsClient, createQuotaTracker } from '../app/lib/hybrid-odds';
import type { LiveEvent } from '../app/lib/live-sports';

// Regression suite for Kilo's independent QA findings HO-1..HO-5b.
// Adapted to the canonical-identity contract: the ToS primary path requires
// a resolvable ESPN event (team names + start) — getEvent stubs supply it.

const NOW = Date.parse('2026-11-21T12:00:00Z');

function oddsEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'odds-1',
    home_team: 'Home Team',
    away_team: 'Away Team',
    commence_time: '2026-11-22T00:00:00Z',
    last_updated: '2026-11-21T11:00:00Z',
    bookmakers: [{
      title: 'DraftKings',
      markets: [
        { key: 'h2h', outcomes: [
          { name: 'Home Team', price: -150 },
          { name: 'Away Team', price: 130 },
        ] },
        { key: 'spreads', outcomes: [
          { name: 'Home Team', price: -110, point: -3.5 },
          { name: 'Away Team', price: -110, point: 3.5 },
        ] },
        { key: 'totals', outcomes: [
          { name: 'Over', price: -105, point: 220.5 },
          { name: 'Under', price: -115, point: 220.5 },
        ] },
      ],
    }],
    ...overrides,
  };
}

function espnEvent(id = 'espn-123'): LiveEvent {
  return {
    id, league: 'nfl', sport: 'football', leagueName: 'NFL',
    name: 'Away Team at Home Team', startsAt: '2026-11-22T00:00:00Z',
    status: 'scheduled', statusText: 'Scheduled', clock: null, period: null,
    home: { id: 'h1', name: 'Home Team', shortName: 'HOME', score: null },
    away: { id: 'a1', name: 'Away Team', shortName: 'AWAY', score: null },
    winner: null, completed: false,
  } as LiveEvent;
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeClient(overrides: {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  env?: Record<string, string>;
  now?: () => number;
  getEvent?: (league: string, id: string) => Promise<LiveEvent | null>;
} = {}) {
  return createHybridOddsClient({
    fetch: overrides.fetch ?? (async () => jsonResponse([oddsEvent()])),
    env: overrides.env ?? { ODDS_API_KEY: 'test-key' },
    now: overrides.now ?? (() => NOW),
    getEvent: overrides.getEvent ?? (async () => espnEvent()),
  });
}

test('HO-1: sourceAt uses the provider timestamp, not local fetch time', async () => {
  const providerTimestamp = '2026-11-21T11:00:00Z';
  const c = makeClient({
    now: () => NOW,
    fetch: async () => jsonResponse([oddsEvent({ last_updated: providerTimestamp })]),
  });
  const result = await c.fetchOddsWithFallback('nfl', 'espn-123');
  assert.equal(result.source, 'the-odds-api');
  assert.equal(result.freshness.sourceAt, providerTimestamp);
  assert.equal(result.freshness.fetchedAt, new Date(NOW).toISOString());
});

test('HO-1b: missing provider timestamp leaves sourceAt null — never fetchedAt', async () => {
  const c = makeClient({
    fetch: async () => jsonResponse([{ ...oddsEvent(), last_updated: undefined }]),
  });
  const result = await c.fetchOddsWithFallback('nfl', 'espn-123');
  assert.equal(result.source, 'the-odds-api');
  assert.equal(result.freshness.sourceAt, null);
  assert.equal(result.freshness.fetchedAt, new Date(NOW).toISOString());
});

test('HO-2: concurrent distinct requests respect the daily credit cap', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const c = makeClient({
    env: { ODDS_API_KEY: 'test-key', ODDS_API_DAILY_CREDITS: '1' },
    fetch: async () => {
      calls += 1;
      await gate;
      return jsonResponse([oddsEvent()]);
    },
  });

  // Two different sport boards — the quota must be reserved atomically.
  const nfl = c.fetchOddsWithFallback('nfl', 'espn-123');
  const nba = c.fetchOddsWithFallback('nba', 'espn-123');
  release();
  await Promise.all([nfl, nba]);

  assert.equal(calls, 1, 'the second request should be refused by the daily cap');
});

test('HO-3: provider exhaustion persists across the UTC day boundary', () => {
  let now = NOW;
  const tracker = createQuotaTracker({ now: () => now, dailyCredits: 500 });
  tracker.allow();
  tracker.observe(new Headers({
    'x-requests-remaining': '0',
    'x-requests-used': '1000',
    'x-requests-last': '1',
  }));
  assert.equal(tracker.snapshot().exhausted, true);
  now += 86_400_000;
  assert.equal(tracker.snapshot().exhausted, true, 'provider exhaustion must not reset at UTC midnight');
  assert.equal(tracker.allow(), false);
  // Provider reporting credits again clears the sticky exhaustion.
  tracker.observe(new Headers({ 'x-requests-remaining': '100', 'x-requests-used': '400' }));
  assert.equal(tracker.snapshot().exhausted, false);
});

test('HO-3b: self-imposed daily cap still resets at UTC midnight', () => {
  let now = NOW;
  const tracker = createQuotaTracker({ now: () => now, dailyCredits: 2 });
  assert.equal(tracker.allow(), true);
  assert.equal(tracker.allow(), true);
  assert.equal(tracker.allow(), false);
  now += 86_400_000;
  assert.equal(tracker.allow(), true);
});

test('HO-4: cached boards report cache hit', async () => {
  let calls = 0;
  const c = makeClient({
    now: () => NOW,
    fetch: async () => {
      calls += 1;
      return jsonResponse([oddsEvent()]);
    },
  });
  await c.fetchOddsWithFallback('nfl', 'espn-123');
  const second = await c.fetchOddsWithFallback('nfl', 'espn-123');
  assert.equal(calls, 1);
  assert.equal(second.freshness.cache, 'hit');
});

test('HO-5a: different ID namespaces never produce a wrong-event substitution', async () => {
  const c = makeClient({
    getEvent: async () => null, // no canonical event → no identity match possible
    fetch: async () => jsonResponse([oddsEvent({ id: 'odds-456' })]),
  });
  const result = await c.fetchOddsWithFallback('nfl', 'espn-123');
  assert.notEqual(result.source, 'the-odds-api');
  assert.equal(result.odds, null);
});

test('HO-5b: matching teams and start time resolve keyed odds via identity', async () => {
  const c = makeClient({
    fetch: async () => jsonResponse([oddsEvent({ id: 'odds-456' })]),
  });
  const result = await c.fetchOddsWithFallback('nfl', 'espn-123');
  assert.equal(result.source, 'the-odds-api');
  assert.equal(result.odds?.provider, 'DraftKings');
});

test('HO-5c: mismatched teams never substitute provider odds', async () => {
  const c = makeClient({
    fetch: async () => jsonResponse([oddsEvent({ home_team: 'Other Team', away_team: 'Different Team' })]),
  });
  const result = await c.fetchOddsWithFallback('nfl', 'espn-123');
  assert.notEqual(result.source, 'the-odds-api');
});

test('circuit breaker recovers after the cooldown window', async () => {
  let now = NOW;
  let calls = 0;
  const c = makeClient({
    now: () => now,
    fetch: async () => {
      calls += 1;
      if (calls <= 3) return jsonResponse({ error: 'down' }, { status: 500 });
      return jsonResponse([oddsEvent()]);
    },
  });

  for (let i = 0; i < 3; i += 1) {
    await c.fetchOddsWithFallback('nfl', 'espn-123');
  }
  const blocked = await c.fetchOddsWithFallback('nfl', 'espn-123');
  assert.equal(calls, 3, 'breaker should block the upstream call while open');
  assert.equal(blocked.freshness.error, 'no_provider');

  now += 60_001;
  const recovered = await c.fetchOddsWithFallback('nfl', 'espn-123');
  assert.equal(calls, 4, 'breaker should allow one probe after cooldown');
  assert.equal(recovered.source, 'the-odds-api');
});
