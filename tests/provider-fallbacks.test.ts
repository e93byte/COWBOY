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

test('LiveScore does not invent a scheduled/live state or final draw when status or scores are absent', () => {
  const events = normalizeLiveScorePayload('epl', 'Premier League', {
    Stages: [{ CompN: 'Premier League', Events: [
      { Eid: 'unknown', Esd: '20261118193000', T1: [{ ID: 'h', Nm: 'Home' }], T2: [{ ID: 'a', Nm: 'Away' }] },
      { Eid: 'final-no-score', Esd: '20261118193000', Eps: 'FT', T1: [{ ID: 'h2', Nm: 'Home 2' }], T2: [{ ID: 'a2', Nm: 'Away 2' }] },
      { Eid: 'invalid-score', Esd: '20261118193000', Eps: 'FT', Tr1: '1.5', Tr2: '-1', T1: [{ ID: 'h3', Nm: 'Home 3' }], T2: [{ ID: 'a3', Nm: 'Away 3' }] },
      { Eid: 'short-time', Esd: '20261118', Eps: 'NS', T1: [{ ID: 'h4', Nm: 'Home 4' }], T2: [{ ID: 'a4', Nm: 'Away 4' }] },
    ] }],
  });
  assert.equal(events.length, 3, 'date-only values do not receive an invented midnight time');
  assert.equal(events[0].status, 'unknown');
  assert.equal(events[0].statusText, 'Status unavailable');
  assert.equal(events[0].winner, null);
  assert.equal(events[1].status, 'final');
  assert.equal(events[1].completed, true);
  assert.equal(events[1].winner, null, 'a final with missing scores stays ungraded');
  assert.equal(events[2].home.score, null);
  assert.equal(events[2].away.score, null);
  assert.equal(events[2].winner, null, 'invalid score values cannot create a result');
});

test('LiveScore accepts only exact known status values and rejects invalid calendar timestamps', () => {
  const events = normalizeLiveScorePayload('epl', 'Premier League', {
    Stages: [{ CompN: 'Premier League', Events: [
      { Eid: 'unknown-status', Esd: '20261118193000', Eps: 'TBD', T1: [{ ID: 'h', Nm: 'Home' }], T2: [{ ID: 'a', Nm: 'Away' }] },
      { Eid: 'invalid-date', Esd: '20261340193000', Eps: 'NS', T1: [{ ID: 'h2', Nm: 'Home 2' }], T2: [{ ID: 'a2', Nm: 'Away 2' }] },
    ] }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'unknown');
});

test('LiveScore infers a draw only from a full-time result, not a penalty result', () => {
  const events = normalizeLiveScorePayload('epl', 'Premier League', {
    Stages: [{ CompN: 'Premier League', Events: [
      { Eid: 'full-time-draw', Esd: '20261118193000', Eps: 'FT', Tr1: '1', Tr2: '1', T1: [{ ID: 'h', Nm: 'Home' }], T2: [{ ID: 'a', Nm: 'Away' }] },
      { Eid: 'penalties', Esd: '20261118193000', Eps: 'AP', Tr1: '1', Tr2: '1', T1: [{ ID: 'h2', Nm: 'Home 2' }], T2: [{ ID: 'a2', Nm: 'Away 2' }] },
    ] }],
  });
  assert.equal(events[0].winner, 'draw');
  assert.equal(events[1].status, 'final');
  assert.equal(events[1].winner, null, 'penalty outcomes need an explicit provider winner');
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

test('TheSportsDB rejects timezone-free timestamps and unknown statuses', () => {
  const events = normalizeSportsDbPayload('nba', 'NBA', { events: [
    { idEvent: 'local-time', idHomeTeam: 'h', idAwayTeam: 'a', strHomeTeam: 'Home', strAwayTeam: 'Away', strTimestamp: '2026-11-18 19:30:00', strStatus: 'Unknown' },
    { idEvent: 'unknown-state', idHomeTeam: 'h2', idAwayTeam: 'a2', strHomeTeam: 'Home 2', strAwayTeam: 'Away 2', strTimestamp: '2026-11-18T19:30:00Z', strStatus: 'TBD', intHomeScore: '2', intAwayScore: '2' },
  ] }, 'basketball');
  assert.equal(events.length, 1, 'timezone-free timestamps cannot be assumed to be UTC');
  assert.equal(events[0].status, 'unknown');
  assert.equal(events[0].statusText, 'TBD');
  assert.equal(events[0].winner, null, 'a tie in a two-way sport is not a draw pick');
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
    home: { id: 'Home', name: 'Home', shortName: 'HOM', score: 3, logo: 'https://example.test/home.png' },
    away: { id: 'Away', name: 'Away', shortName: 'AWY', score: 1 }, venue: 'Stadium',
    scoreSource: 'OpenLigaDB', winner: 'home', completed: true,
  });
});

test('OpenLigaDB does not infer a live window or a final score from partial history', () => {
  const events = normalizeOpenLigaPayload('bundesliga', 'Bundesliga', [
    { matchID: 31, matchDateTimeUTC: '2026-11-18T19:30:00Z', matchIsFinished: false,
      team1: { teamName: 'Home' }, team2: { teamName: 'Away' }, goals: [{ scoreTeam1: 1, scoreTeam2: 0 }] },
    { matchID: 32, matchDateTimeUTC: '2026-11-18T19:30:00Z', matchIsFinished: true,
      team1: { teamName: 'Home 2' }, team2: { teamName: 'Away 2' }, goals: [{ scoreTeam1: 2, scoreTeam2: 1 }],
      matchResults: [{ resultTypeID: 1, pointsTeam1: 1, pointsTeam2: 0 }] },
  ], Date.parse('2026-11-20T12:00:00Z'));
  assert.equal(events[0].status, 'unknown', 'an old unfinished fixture is not assumed to be live or scheduled');
  assert.equal(events[0].home.score, 1, 'the source goal snapshot may still be displayed');
  assert.equal(events[0].winner, null);
  assert.equal(events[1].status, 'final');
  assert.equal(events[1].home.score, null, 'partial-time results are not treated as final scores');
  assert.equal(events[1].winner, null);
});
