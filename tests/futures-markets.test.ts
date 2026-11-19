import assert from 'node:assert/strict';
import test from 'node:test';
import { createFuturesClient } from '../app/lib/futures-markets';

const market = (name: string, yesAsk: string, status = 'active') => ({
  ticker: `M-${name}`, title: name, yes_sub_title: name,
  yes_ask_dollars: yesAsk, status,
});

const outrightEvent = (ticker: string, title: string, markets: ReturnType<typeof market>[]) => ({
  event_ticker: ticker, title, markets,
});
const gameEvent = (ticker: string, title: string) => outrightEvent(ticker, title, [market('A', '0.55'), market('B', '0.45')]);

const SERIES = [
  { ticker: 'KXNHL', title: 'Stanley Cup', category: 'Sports', tags: ['Hockey'] },
  { ticker: 'KXNHLGAME', title: 'NHL Game', category: 'Sports', tags: ['Hockey'] },
  { ticker: 'KXUCL', title: 'UEFA Champions League', category: 'Sports', tags: ['Soccer'] },
  { ticker: 'KXUCLHOC', title: 'Champions League Hockey', category: 'Soccer', tags: ['Hockey'] },
  { ticker: 'KXWTA', title: 'WTA Tournament Winner', category: 'Sports', tags: ['Tennis'] },
  { ticker: 'KXNBATEAM', title: 'NBA Team Futures', category: 'Sports', tags: ['Basketball'] },
];

const EVENTS: Record<string, unknown[]> = {
  KXNHL: [
    outrightEvent('EVT1', '2026-27 Stanley Cup Final Winner', [
      market('Panthers', '0.1800'), market('Oilers', '0.1600'), market('Knights', '0.0700'),
    ]),
  ],
  KXNHLGAME: [gameEvent('G1', 'Buffalo vs Washington'), gameEvent('G2', 'Montreal vs Carolina')],
  KXUCL: [outrightEvent('EVT2', 'Champions League Winner', [
    market('Real Madrid', '0.2200'), market('PSG', '0.1400'), market('Arsenal', '0.0900'),
  ])],
  KXNBATEAM: [outrightEvent('EVT3', 'Pro Basketball Championship Winner', [
    market('Celtics', '0.2000'), market('Thunder', '0.1900'), market('Knicks', '0.0600'),
  ])],
};

function mockFetch() {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.includes('/series')) {
      return Response.json({ series: SERIES });
    }
    const ticker = new URL(url).searchParams.get('series_ticker') ?? '';
    return Response.json({ events: EVENTS[ticker] ?? [] });
  };
  return { fetcher, calls };
}

test('futures matches league rules, keeps outright boards, drops game markets', async () => {
  const { fetcher, calls } = mockFetch();
  const client = createFuturesClient({ fetch: fetcher });
  const nhl = await client.get('nhl');
  assert.ok(nhl);
  assert.equal(nhl.boards.length, 1);
  assert.equal(nhl.boards[0].title, '2026-27 Stanley Cup Final Winner');
  assert.deepEqual(nhl.boards[0].outcomes.map(o => o.name), ['Panthers', 'Oilers', 'Knights']);
  assert.equal(nhl.boards[0].outcomes[0].probability, 0.18);
  // NHL Game series is also matched by "nhl" but its 2-market events are dropped.
  assert.ok(calls.some(url => url.includes('series_ticker=KXNHLGAME')));

  const ucl = await client.get('ucl');
  assert.deepEqual(ucl?.boards[0].outcomes.map(o => o.name), ['Real Madrid', 'PSG', 'Arsenal']);

  const nba = await client.get('nba');
  assert.deepEqual(nba?.boards[0].outcomes.map(o => o.name), ['Celtics', 'Thunder', 'Knicks']);

  const atp = await client.get('atp');
  assert.equal(atp, null, 'no outright ATP series events');
  assert.equal(await client.get('not-a-league'), null);
});

test('futures caches series and league results', async () => {
  let clock = 2_000_000;
  let calls = 0;
  const client = createFuturesClient({
    now: () => clock,
    fetch: async url => {
      calls++;
      if (url.includes('/series')) return Response.json({ series: SERIES });
      const ticker = new URL(url).searchParams.get('series_ticker') ?? '';
      return Response.json({ events: EVENTS[ticker] ?? [] });
    },
  });
  await client.get('nhl');
  await client.get('ucl');
  await client.get('nhl');
  assert.equal(calls, 4, 'one series page + nhl/ucl event fetches; repeat league cached');
  clock += 61_000;
  await client.get('nba');
  assert.equal(calls, 5, 'series list cached; only new league events fetched');
});

test('futures tolerates provider failure and returns null', async () => {
  const client = createFuturesClient({ fetch: async () => new Response(null, { status: 503 }) });
  assert.equal(await client.get('nba'), null);
  assert.equal(await client.get('nba'), null, 'failure backoff avoids refetching');
});
