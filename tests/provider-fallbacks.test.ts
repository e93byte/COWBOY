import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLiveScorePayload, normalizeOpenLigaPayload, normalizeSportsDbPayload } from '../app/lib/provider-fallbacks';

test('normalizes LiveScore soccer stages without inventing a competition', () => {
  const events = normalizeLiveScorePayload('epl', 'Premier League', {
    Stages: [{ Cnm: 'England', CompN: 'Premier League', Events: [{
      Eid: '10001', Esd: '20261118193000', Eps: '1H', Tr1: '1', Tr2: '0',
      T1: [{ ID: 'home-1', Nm: 'Home FC', Abr: 'HOM' }], T2: [{ ID: 'away-1', Nm: 'Away FC', Abr: 'AWY' }],
    }, {
      Eid: '10002', Esd: '20261118193000', Eps: 'FT', Tr1: 'x', Tr2: '2',
      T1: [{ Nm: 'Bad Home' }], T2: [{ Nm: 'Bad Away' }],
    }]}],
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    id: '10001', league: 'epl', sport: 'soccer', leagueName: 'Premier League',
    name: 'Away FC at Home FC', startsAt: '2026-11-18T19:30:00.000Z', status: 'live', statusText: '1H', clock: null, period: null,
    home: { id: 'home-1', name: 'Home FC', shortName: 'HOM', score: 1 },
    away: { id: 'away-1', name: 'Away FC', shortName: 'AWY', score: 0 },
    scoreSource: 'LiveScore', winner: null, completed: false,
  });
});

test('matches LiveScore aliases across the expanded soccer catalog without cross-country collisions', async () => {
  const { liveScoreStageMatches } = await import('../app/lib/provider-fallbacks');
  assert.equal(liveScoreStageMatches('efl', { Cnm: 'England', CompN: 'Championship' }), true);
  assert.equal(liveScoreStageMatches('brasileirao', { Cnm: 'Brazil', CompN: 'Serie A' }), true);
  assert.equal(liveScoreStageMatches('aleague', { Cnm: 'Australia', CompN: 'A-League' }), true);
  assert.equal(liveScoreStageMatches('facup', { Cnm: 'England', CompN: 'FA Cup' }), true);
  assert.equal(liveScoreStageMatches('brasileirao', { Cnm: 'Italy', CompN: 'Serie A' }), false);
});

test('normalizes TheSportsDB events and rejects incomplete identities', () => {
  const events = normalizeSportsDbPayload('epl', 'Premier League', {
    events: [{
      idEvent: '30001', strEvent: 'Home FC vs Away FC', strLeague: 'English Premier League',
      idHomeTeam: 'home-3', idAwayTeam: 'away-3', strHomeTeam: 'Home FC', strAwayTeam: 'Away FC',
      intHomeScore: '2', intAwayScore: '1', strStatus: 'FT', strTimestamp: '2026-11-18T19:30:00Z', strVenue: 'Main Stadium',
      strHomeTeamBadge: 'https://example.test/home.png', strAwayTeamBadge: 'https://example.test/away.png',
    }, { idEvent: 'bad', strHomeTeam: 'Only Home' }],
  });
  assert.deepEqual(events[0], {
    id: '30001', league: 'epl', sport: 'soccer', leagueName: 'Premier League', name: 'Home FC vs Away FC',
    startsAt: '2026-11-18T19:30:00.000Z', status: 'final', statusText: 'FT', clock: null, period: null,
    home: { id: 'home-3', name: 'Home FC', shortName: 'Home FC', score: 2, logo: 'https://example.test/home.png' },
    away: { id: 'away-3', name: 'Away FC', shortName: 'Away FC', score: 1, logo: 'https://example.test/away.png' },
    venue: 'Main Stadium', scoreSource: 'SportsDB', winner: 'home', completed: true,
  });
  assert.equal(events.length, 1);
});

test('normalizes OpenLiga results with home/away identity and final score', () => {
  const events = normalizeOpenLigaPayload('bundesliga', 'Bundesliga', [{
    matchID: 22, matchDateTimeUTC: '2026-11-18T19:30:00Z', matchIsFinished: true,
    team1: { teamName: 'Home', shortName: 'HOM', teamIconUrl: 'https://example.test/home.png' },
    team2: { teamName: 'Away', shortName: 'AWY' },
    matchResults: [{ resultTypeID: 2, pointsTeam1: 3, pointsTeam2: 1 }],
    location: { locationStadium: 'Stadium' },
  }]);
  assert.deepEqual(events[0], {
    id: '22', league: 'bundesliga', sport: 'soccer', leagueName: 'Bundesliga',
    name: 'Away at Home', startsAt: '2026-11-18T19:30:00.000Z', status: 'final', statusText: 'Final', clock: null, period: null,
    home: { id: '22-home', name: 'Home', shortName: 'HOM', score: 3, logo: 'https://example.test/home.png' },
    away: { id: '22-away', name: 'Away', shortName: 'AWY', score: 1 }, venue: 'Stadium',
    scoreSource: 'OpenLigaDB', winner: 'home', completed: true,
  });
});
