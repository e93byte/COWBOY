import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveSportsClient } from '../app/lib/live-sports';

test('failed soccer primary feed cold-starts from the public fallback and labels freshness generically', async () => {
  const now = Date.parse('2026-11-18T20:00:00Z');
  const calls: string[] = [];
  const client = createLiveSportsClient({now: () => now, fetch: async input => {
    const url = new URL(String(input));
    calls.push(url.hostname + url.pathname);
    if (url.hostname === 'site.api.espn.com') return new Response(null, {status: 503});
    if (url.hostname === 'prod-public-api.livescore.com' && url.pathname.endsWith('/0')) {
      return Response.json({Stages: [{Cnm: 'England', CompN: 'Premier League', Events: [{
        Eid: '20001', Esd: '20261118193000', Eps: '1H', Tr1: '1', Tr2: '0',
        T1: [{ID: 'home-1', Nm: 'Home FC', Abr: 'HOM'}], T2: [{ID: 'away-1', Nm: 'Away FC', Abr: 'AWY'}],
      }]}]});
    }
    if (url.hostname === 'prod-public-api.livescore.com') return Response.json({Stages: []});
    return new Response(null, {status: 404});
  }});
  const board = await client.getLiveBoard('epl');
  const league = board.leagues.find(item => item.id === 'epl');
  assert.equal(league?.status, 'stale');
  assert.equal(league?.backupSource, 'LiveScore');
  assert.equal(board.events[0].id, '20001');
  assert.equal(board.events[0].scoreSource, 'LiveScore');
  assert.ok(calls.some(call => call.startsWith('prod-public-api.livescore.com/')));
});

test('uses the configured SportsDB fallback only after public soccer sources return no events', async () => {
  const previousKey = process.env.SPORTSDB_KEY;
  process.env.SPORTSDB_KEY = 'test-key';
  const calls: string[] = [];
  try {
    const client = createLiveSportsClient({now: () => Date.parse('2026-11-18T20:00:00Z'), fetch: async input => {
      const url = new URL(String(input));
      calls.push(url.hostname + url.pathname);
      if (url.hostname === 'site.api.espn.com') return new Response(null, {status: 503});
      if (url.hostname === 'prod-public-api.livescore.com') return Response.json({Stages: []});
      if (url.hostname === 'www.thesportsdb.com') return Response.json({events: [{
        idEvent: '30001', strLeague: 'English Premier League', strEvent: 'Home FC vs Away FC',
        idHomeTeam: 'home-3', idAwayTeam: 'away-3', strHomeTeam: 'Home FC', strAwayTeam: 'Away FC',
        intHomeScore: '2', intAwayScore: '1', strStatus: 'FT', strTimestamp: '2026-11-18T19:30:00Z',
      }]});
      return new Response(null, {status: 404});
    }});
    const board = await client.getLiveBoard('epl');
    const league = board.leagues.find(item => item.id === 'epl');
    assert.equal(league?.backupSource, 'SportsDB');
    assert.equal(board.events.find(event => event.id === '30001')?.scoreSource, 'SportsDB');
    assert.ok(calls.some(call => call.startsWith('www.thesportsdb.com/')));
  } finally {
    if (previousKey === undefined) delete process.env.SPORTSDB_KEY;
    else process.env.SPORTSDB_KEY = previousKey;
  }
});
