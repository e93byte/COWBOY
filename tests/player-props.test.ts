import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayerPropsClient } from '../app/lib/player-props';

const propItem = (athleteId: string, type: string, line: number, american: number) => ({
  athlete: { $ref: `http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/athletes/${athleteId}?lang=en&region=us` },
  type: { id: '1', name: type },
  odds: { american: { value: String(american) } },
  current: { target: { value: line, displayValue: String(line) } },
});

const propsPayload = {
  count: 5,
  items: [
    propItem('3992', 'Total Points', 25.5, -110),
    propItem('3992', 'Total Points', 25.5, -115),
    propItem('3993', 'Total Rebounds', 8.5, 120),
    propItem('3993', 'Total Rebounds', 8.5, -140),
    propItem('3994', 'Total Points', 30.5, -105), // unpaired: dropped
  ],
};

const summaryPayload = {
  boxscore: {
    players: [{
      team: {},
      statistics: [{
        athletes: [
          { athlete: { id: '3992', displayName: 'LeBron James' } },
          { athlete: { id: '3993', displayName: 'Anthony Davis' } },
        ],
      }],
    }],
  },
};

test('player props groups over/under pairs and resolves athlete names', async () => {
  const client = createPlayerPropsClient({ fetch: async url => {
    const target = String(url);
    if (target.includes('propBets')) return Response.json(propsPayload);
    if (target.includes('/summary')) return Response.json(summaryPayload);
    return new Response(null, { status: 404 });
  } });
  const result = await client.get('nba', '401910007');
  assert.ok(result);
  assert.equal(result.book, 'DraftKings');
  assert.equal(result.props.length, 2);
  assert.deepEqual(result.props[0], { player: 'LeBron James', name: 'Points', line: 25.5, over: -110, under: -115 });
  assert.deepEqual(result.props[1], { player: 'Anthony Davis', name: 'Rebounds', line: 8.5, over: 120, under: -140 });
});

test('player props caches successes and backs off failures', async () => {
  let clock = 1_000_000;
  let calls = 0;
  const client = createPlayerPropsClient({ now: () => clock, fetch: async url => {
    calls++;
    return String(url).includes('propBets') ? Response.json(propsPayload) : Response.json(summaryPayload);
  } });
  await client.get('nba', '401910007');
  await client.get('nba', '401910007');
  assert.equal(calls, 2, 'propBets + summary fetched once; second call served from cache');
  clock += 11 * 60_000;
  await client.get('nba', '401910007');
  assert.equal(calls, 4, 'success TTL expired refetches both endpoints');

  let failingCalls = 0;
  const failing = createPlayerPropsClient({ now: () => clock, fetch: async () => { failingCalls++; return new Response(null, { status: 503 }); } });
  assert.equal(await failing.get('nba', '401910007'), null);
  assert.equal(failingCalls, 2);
  await failing.get('nba', '401910007');
  assert.equal(failingCalls, 2, 'failure backoff serves cached null without refetching');
});

test('player props rejects unsupported leagues and malformed ids without fetching', async () => {
  let calls = 0;
  const client = createPlayerPropsClient({ fetch: async () => { calls++; return Response.json({}); } });
  assert.equal(await client.get('atp', '123'), null);
  assert.equal(await client.get('nba', 'not-an-id'), null);
  assert.equal(await client.get('pga', '123'), null);
  assert.equal(calls, 0);
});

test('player props returns null when the provider has no items', async () => {
  const client = createPlayerPropsClient({ fetch: async url =>
    String(url).includes('propBets') ? Response.json({ items: [] }) : Response.json(summaryPayload) });
  assert.equal(await client.get('nba', '401910007'), null);
});

test('player props omit rows whose athlete name cannot be resolved from source data', async () => {
  const client = createPlayerPropsClient({ fetch: async url => {
    const target = String(url);
    if (target.includes('propBets')) return Response.json({ items: [
      propItem('3992', 'Total Points', 25.5, -110),
      propItem('3992', 'Total Points', 25.5, -115),
    ] });
    if (target.includes('/summary')) return Response.json({ boxscore: { players: [] } });
    if (target.includes('/roster')) return Response.json({ athletes: [] });
    return new Response(null, { status: 404 });
  } });
  assert.equal(await client.get('nba', '401910007'), null);
});
