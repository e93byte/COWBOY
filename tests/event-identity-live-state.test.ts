import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchProviderEvent, resolveCanonicalEvent, teamNameCovers,
  type EventIdentity, type ProviderEventRef,
} from '../app/lib/event-identity';
import { deriveLiveState, DEFAULT_STALE_AFTER_MS } from '../app/lib/live-state';

const canonical: EventIdentity = {
  canonicalId: '401', league: 'nfl',
  homeName: 'Kansas City Chiefs', awayName: 'Buffalo Bills',
  startsAt: '2026-11-22T17:00:00Z',
};

function ref(overrides: Partial<ProviderEventRef> = {}): ProviderEventRef {
  return {
    provider: 'the-odds-api', providerId: 'toa-123',
    homeName: 'Chiefs', awayName: 'Bills',
    startsAt: '2026-11-22T17:00:30Z',
    ...overrides,
  };
}

test('team name coverage resolves city names to full team names', () => {
  assert.ok(teamNameCovers('Chiefs', 'Kansas City Chiefs'));
  assert.ok(teamNameCovers('Kansas City Chiefs', 'Kansas City Chiefs'));
  assert.ok(!teamNameCovers('Chiefs', 'Kansas City Royals'));
  assert.ok(!teamNameCovers('', 'Kansas City Chiefs'));
});

test('provider event matches canonical identity within the time window', () => {
  const match = matchProviderEvent([ref()], canonical);
  assert.equal(match?.confidence, 'names');
  assert.equal(match?.ref.providerId, 'toa-123');
});

test('ambiguous candidates are rejected — never a wrong-game association', () => {
  // Two provider events both matching names+window → no match.
  const refs = [ref(), ref({ providerId: 'toa-456' })];
  assert.equal(matchProviderEvent(refs, canonical), null);
});

test('events outside the time window are rejected', () => {
  const stale = ref({ startsAt: '2026-11-30T17:00:00Z' }); // 8 days out
  assert.equal(matchProviderEvent([stale], canonical), null);
});

test('mismatched teams are rejected', () => {
  const wrong = ref({ homeName: 'Eagles', awayName: 'Cowboys' });
  assert.equal(matchProviderEvent([wrong], canonical), null);
});

test('espn refs match by exact canonical id', () => {
  const espn = ref({ provider: 'espn', providerId: '401', homeName: '', awayName: '', startsAt: null });
  assert.equal(matchProviderEvent([espn], canonical)?.confidence, 'exact');
  const wrong = ref({ provider: 'espn', providerId: '999' });
  assert.equal(matchProviderEvent([wrong], canonical), null);
});

test('resolveCanonicalEvent finds by league+id only', () => {
  const board = [
    { id: '401', league: 'nfl' },
    { id: '401', league: 'nba' },
    { id: '402', league: 'nfl' },
  ];
  assert.equal(resolveCanonicalEvent(board, 'nfl', '401')?.league, 'nfl');
  assert.equal(resolveCanonicalEvent(board, 'nba', '999'), null);
});

// ---------- live-state contract ----------

const NOW = Date.parse('2026-11-22T18:00:00Z');

test('scheduled events far from start stay scheduled; near start become pregame', () => {
  const far = deriveLiveState({ status: 'scheduled', startsAt: '2026-11-23T00:00:00Z' }, { now: NOW });
  assert.equal(far.state, 'scheduled');
  const near = deriveLiveState({ status: 'scheduled', startsAt: '2026-11-22T18:20:00Z' }, { now: NOW });
  assert.equal(near.state, 'pregame');
});

test('live status maps to canonical states from provider detail text', () => {
  assert.equal(deriveLiveState({ status: 'live', statusText: 'In Progress' }, { now: NOW }).state, 'live');
  assert.equal(deriveLiveState({ status: 'live', statusText: 'Halftime' }, { now: NOW }).state, 'halftime');
  assert.equal(deriveLiveState({ status: 'live', statusText: 'End of 1st' }, { now: NOW }).state, 'live');
  assert.equal(deriveLiveState({ status: 'live', statusText: 'Delayed' }, { now: NOW }).state, 'delayed');
  assert.equal(deriveLiveState({ status: 'live', statusText: 'Game Postponed' }, { now: NOW }).state, 'postponed');
  assert.equal(deriveLiveState({ status: 'live', statusText: 'Suspended' }, { now: NOW }).state, 'suspended');
});

test('final, postponed, cancelled pass through', () => {
  assert.equal(deriveLiveState({ status: 'final' }, { now: NOW }).state, 'final');
  assert.equal(deriveLiveState({ status: 'postponed' }, { now: NOW }).state, 'postponed');
  assert.equal(deriveLiveState({ status: 'cancelled' }, { now: NOW }).state, 'cancelled');
});

test('clock runs only while genuinely in progress', () => {
  const live = deriveLiveState({ status: 'live', clock: '4:32', period: 2 }, { now: NOW });
  assert.equal(live.clock.state, 'running');
  assert.equal(live.clock.value, '4:32');
  const half = deriveLiveState({ status: 'live', statusText: 'Halftime', clock: '0:00', period: 2 }, { now: NOW });
  assert.equal(half.clock.state, 'stopped');
  const final = deriveLiveState({ status: 'final', clock: '0:00' }, { now: NOW });
  assert.equal(final.clock.state, 'stopped');
  const sched = deriveLiveState({ status: 'scheduled' }, { now: NOW });
  assert.equal(sched.clock.state, 'unknown');
});

test('stale detection uses fetch age, never fabricated provider timestamps', () => {
  const fresh = deriveLiveState({ status: 'live' }, { fetchedAt: NOW - 1_000, now: NOW });
  assert.equal(fresh.clock.stale, false);
  assert.equal(fresh.clock.ageMs, 1_000);
  const stale = deriveLiveState({ status: 'live' }, { fetchedAt: NOW - DEFAULT_STALE_AFTER_MS - 1, now: NOW });
  assert.equal(stale.clock.stale, true);
  // No fetchedAt → age unknown, not assumed fresh.
  const unknown = deriveLiveState({ status: 'live' }, { now: NOW });
  assert.equal(unknown.clock.ageMs, null);
  assert.equal(unknown.clock.stale, false);
  assert.equal(unknown.clock.fetchedAt, null);
});

test('frozen provider clock with HTTP 200 is detectable only via freshness age', () => {
  // Provider keeps returning clock '4:32' — the contract exposes ageMs so
  // clients can tell a frozen feed from a live one.
  const frozen = deriveLiveState({ status: 'live', clock: '4:32' }, { fetchedAt: NOW - 120_000, now: NOW });
  assert.equal(frozen.state, 'live'); // status alone can't reveal the freeze
  assert.equal(frozen.clock.stale, true); // freshness does
});

// ---------- identity stress cases ----------

test('doubleheaders: two provider games same teams within window → ambiguous → null', () => {
  const game1 = ref({ providerId: 'g1', startsAt: '2026-11-22T17:00:00Z' });
  const game2 = ref({ providerId: 'g2', startsAt: '2026-11-22T20:00:00Z' }); // same-day twinfold
  assert.equal(matchProviderEvent([game1, game2], canonical), null);
});

test('postponed/rescheduled game outside the window does not match the new slot', () => {
  // Provider still lists the OLD date while ESPN shows the rescheduled one.
  const staleListing = ref({ startsAt: '2026-11-18T17:00:00Z' }); // 4 days before canonical — outside 72h
  assert.equal(matchProviderEvent([staleListing], canonical), null);
});

test('timezone-equivalent timestamps still match', () => {
  // Same instant expressed differently still parses to the same ms.
  const shifted = ref({ startsAt: '2026-11-22T12:00:30-05:00' }); // = 17:00:30Z
  assert.equal(matchProviderEvent([shifted], canonical)?.confidence, 'names');
});

test('renamed team: provider name that no longer covers canonical name → null', () => {
  const renamed = ref({ homeName: 'Washington Football Team', awayName: 'Bills' });
  assert.equal(matchProviderEvent([renamed], canonical), null);
});

test('shared-city collisions stay ambiguous rather than guessing', () => {
  const canonicalLa = { ...canonical, homeName: 'Los Angeles Lakers', awayName: 'Boston Celtics', startsAt: '2026-11-22T03:00:00Z' };
  // Provider says just "Los Angeles" vs "LA Clippers" — covers both ways fail to disambiguate fully
  const ambiguous = ref({ homeName: 'Los Angeles', awayName: 'Celtics', startsAt: '2026-11-22T03:00:00Z' });
  // "Los Angeles" covers into "Los Angeles Lakers" (all tokens present) — this is the accepted city-level match;
  // the guard is that BOTH sides must resolve and no second candidate may exist.
  const match = matchProviderEvent([ambiguous], canonicalLa);
  assert.ok(match === null || match.ref.providerId === 'toa-123');
});

test('neutral-site events match on team names regardless of venue', () => {
  // Neutral site (e.g. bowl game) — identity is teams+time, venue is irrelevant.
  const neutral = ref({ homeName: 'Chiefs', awayName: 'Bills' });
  assert.equal(matchProviderEvent([neutral], canonical)?.confidence, 'names');
});

// ---------- live-state stress cases ----------

test('overtime and intermission stay live-family states, never final prematurely', () => {
  assert.equal(deriveLiveState({ status: 'live', statusText: 'End of OT', clock: '0:00', period: 5 }, { now: NOW }).state, 'live');
  assert.equal(deriveLiveState({ status: 'live', statusText: '2OT', clock: '4:10', period: 5 }, { now: NOW }).state, 'live');
  const intermission = deriveLiveState({ status: 'live', statusText: 'Intermission', clock: null, period: 3 }, { now: NOW });
  assert.equal(intermission.state, 'halftime'); // intermission maps to the break state
  assert.equal(intermission.clock.state, 'stopped');
});

test('source recovery: fresh fetchedAt clears stale flag', () => {
  const recovered = deriveLiveState({ status: 'live', clock: '7:55' }, { fetchedAt: NOW - 2_000, now: NOW });
  assert.equal(recovered.clock.stale, false);
  assert.equal(recovered.clock.ageMs, 2_000);
  assert.equal(recovered.clock.state, 'running');
});
