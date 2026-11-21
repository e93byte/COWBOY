import assert from 'node:assert/strict';
import test from 'node:test';
import { LIVE_LEAGUES, SOURCE_LEAGUES, SPORTS_CATALOGUE } from '../app/lib/sports-leagues';
import { allScheduleZones, parseSharedScheduleZone } from '../app/lib/schedule-time';
import { SportFeedRegistry, type SportFeedAdapter } from '../app/lib/sport-feed-adapter';

test('global catalogue has 180+ unique competitions with honest source availability', () => {
  assert.ok(SPORTS_CATALOGUE.length >= 180, `expected 180+ competitions, received ${SPORTS_CATALOGUE.length}`);
  assert.equal(new Set(SPORTS_CATALOGUE.map(league => league.id)).size, SPORTS_CATALOGUE.length);
  for (const league of SPORTS_CATALOGUE) {
    assert.ok(league.name.trim());
    assert.ok(league.sport.trim());
    assert.ok(league.region.trim());
    assert.ok(league.provider.trim());
    if (!league.sourceEnabled) {
      assert.equal(league.availability, 'unsupported');
      assert.equal(league.path, '');
    }
  }
  assert.ok(SOURCE_LEAGUES.length > 0);
  assert.ok(SOURCE_LEAGUES.length < SPORTS_CATALOGUE.length);
  assert.ok(SOURCE_LEAGUES.every(league => league.availability === 'live' && league.path));
});

test('timezone selector provides device, UTC, and IANA timezone choices', () => {
  const zones = allScheduleZones();
  assert.ok(zones.some(zone => zone.id === 'local'));
  assert.ok(zones.some(zone => zone.id === 'UTC'));
  assert.equal(parseSharedScheduleZone(new URLSearchParams('tz=Asia/Tokyo')), 'Asia/Tokyo');
  assert.equal(parseSharedScheduleZone(new URLSearchParams('tz=Not/AZone')), null);
});

test('provider registry exposes only adapters that explicitly support a league', () => {
  const registry = new SportFeedRegistry();
  const adapter: SportFeedAdapter = {
    id: 'test-source', label: 'Test Source',
    supports: league => league.id === 'nba',
    getSchedule: async () => ({ events: [], freshness: { fetchedAt: new Date().toISOString(), stale: false }, availability: 'live' }),
    getEvent: async () => null,
  };
  registry.register(adapter);
  assert.equal(registry.forLeague(LIVE_LEAGUES.find(league => league.id === 'nba')!), adapter);
  assert.equal(registry.forLeague(SPORTS_CATALOGUE.find(league => league.id === 'f1')!), null);
  assert.throws(() => registry.register(adapter), /unique/);
});
