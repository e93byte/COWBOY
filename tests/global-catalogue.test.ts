import assert from 'node:assert/strict';
import test from 'node:test';
import { LIVE_LEAGUES, SOURCE_LEAGUES, SPORTS_CATALOGUE } from '../app/lib/sports-leagues';
import { allScheduleZones, parseSharedScheduleZone } from '../app/lib/schedule-time';
import { SportFeedRegistry, type SportFeedAdapter } from '../app/lib/sport-feed-adapter';
import { localeMetadata, resolveLocale, SUPPORTED_LOCALES } from '../app/lib/locales';
import { presentEvent } from '../app/lib/event-presentation';

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

test('global language preferences retain English fallback and Arabic RTL metadata', () => {
  assert.equal(SUPPORTED_LOCALES.length, 9);
  assert.equal(resolveLocale('es-MX'), 'es');
  assert.equal(resolveLocale('not-a-locale'), 'en');
  assert.equal(localeMetadata('ar').direction, 'rtl');
});

test('event presentation scopes backup freshness and free-pick availability to the affected league', () => {
  const event: any = {id:'game-1',league:'nba',sport:'basketball',leagueName:'NBA',name:'Away at Home',startsAt:'2030-01-01T12:00:00Z',status:'scheduled',home:{},away:{}};
  const checkedAt = '2029-01-01T00:00:00Z';
  const now = Date.parse(checkedAt);
  const league = {id:'nba',sport:'basketball',name:'NBA',status:'stale',backupSource:'ESPN summary',scoresUpdatedAt:checkedAt} as const;
  const fromBackup = {...event, scoreSource:'ESPN summary'};
  const backup = presentEvent(fromBackup, {now, league});
  assert.equal(backup.freshness, 'backup-current');
  assert.equal(backup.gamePhase, 'scheduled');
  assert.equal(backup.pickEligible, false);
  assert.equal(presentEvent(event, {now, league}).freshness, 'delayed');
  assert.equal(presentEvent(fromBackup, {now: now + 60_000, league}).freshness, 'delayed');
  const delayed = presentEvent(event, {now: 0, league:{id:'nba',sport:'basketball',name:'NBA',status:'stale',lastSuccessAt:'2030-01-01T00:00:00Z'}});
  assert.equal(delayed.freshness, 'delayed');
  assert.match(delayed.pickReason ?? '', /delayed/);
});

test('event presentation flags a stale live clock without hiding fresh live games', () => {
  const now = Date.parse('2030-01-01T12:00:00Z');
  const live: any = {id:'game-live',league:'nba',sport:'basketball',leagueName:'NBA',name:'Away at Home',
    startsAt:'2030-01-01T11:00:00Z',status:'live',statusText:'Q3 4:32',clock:'4:32',period:3,
    home:{id:'1',name:'Home',shortName:'H',score:80},away:{id:'2',name:'Away',shortName:'A',score:75},winner:null,completed:false};
  const okLeague = (lastSuccessAt: string) => ({id:'nba',sport:'basketball',name:'NBA',status:'ok' as const,lastSuccessAt});
  // Fresh confirming feed: live stays clean.
  const fresh = presentEvent(live, {now, league: okLeague('2030-01-01T11:59:58Z')});
  assert.equal(fresh.freshness, 'current');
  assert.equal(fresh.liveState, 'live');
  assert.equal(fresh.clockState, 'running');
  assert.equal(fresh.clockStale, false);
  // Frozen feed: provider still says live but last confirmation is old.
  const frozen = presentEvent(live, {now, league: okLeague('2030-01-01T11:59:00Z')});
  assert.equal(frozen.freshness, 'current'); // league-level still reads ok
  assert.equal(frozen.clockStale, true);
  assert.ok((frozen.clockAgeMs ?? 0) > 30_000);
  // Scheduled games never flag a stale clock.
  const scheduled = {...live, status:'scheduled', clock:null, period:null};
  const sched = presentEvent(scheduled, {now, league: okLeague('2030-01-01T11:59:00Z')});
  assert.equal(sched.clockStale, false);
  assert.equal(sched.clockState, 'unknown');
  // Unknown freshness (no timestamps) is not assumed stale.
  const unknown = presentEvent(live, {now, league: {id:'nba',sport:'basketball',name:'NBA',status:'ok' as const}});
  assert.equal(unknown.clockStale, false);
  assert.equal(unknown.clockAgeMs, null);
});
