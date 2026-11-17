import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as live from '../app/lib/live-sports';

const baseFixtures = JSON.parse(readFileSync(new URL('./fixtures/live-sports/scoreboards.json', import.meta.url), 'utf8'));
const expandedFixtures = JSON.parse(readFileSync(new URL('./fixtures/live-sports/expanded-scoreboards.json', import.meta.url), 'utf8'));
const fixtures = { ...baseFixtures, ...expandedFixtures };
const summaries = JSON.parse(readFileSync(new URL('./fixtures/live-sports/summaries.json', import.meta.url), 'utf8'));

test('GET /api/sports serves the normalized board without inventing a golf matchup', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const pathname = new URL(String(input)).pathname;
    const config = live.LIVE_LEAGUES.find(l => pathname.endsWith(`${l.path}/scoreboard`))!;
    assert.ok(config);
    return Response.json(fixtures[config.id]);
  };
  try {
    const route = await import('../app/api/sports/route');
    const response = await route.GET(new Request('https://cowboy.test/api/sports'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.source, 'ESPN');
    assert.equal(body.leagues.length, live.LIVE_LEAGUES.length);
    assert.ok(body.events.length > 10);
    assert.equal(body.leagues.find((l: any) => l.id === 'pga').status, 'ok');
    assert.equal(body.golf[0].id, '401850980');
    assert.ok(body.golf[0].leaderboard.length > 2);
    assert.ok(!body.events.some((event: live.LiveEvent) => event.league === 'pga'));
    for (const key of ['ncaab', 'ncaaw', 'mls', 'ucl', 'bundesliga', 'seriea', 'ligue1', 'ligue2', 'efl', 'facup', 'brasileirao', 'aleague', 'nationsleague', 'nwsl', 'wsl', 'ligamx', 'argentina', 'premrugby', 'ncaah', 'ncaawh', 'concacafnl', 'afconqual', 'top14', 'championsrugby']) {
      assert.equal(body.leagues.find((l: any) => l.id === key).status, 'ok');
      assert.ok(body.events.some((event: live.LiveEvent) => event.league === key));
    }
    const cupGame = body.events.find((event: live.LiveEvent) => event.league === 'facup' && event.id === '401931098');
    assert.deepEqual([cupGame.status, cupGame.statusText, cupGame.winner], ['final', 'AET', 'home']);
    const penalties = body.events.find((event: live.LiveEvent) => event.league === 'facup' && event.id === '700836');
    assert.deepEqual([penalties.status,penalties.winner,penalties.away.score,penalties.home.score], ['final','away',3,3]);
    assert.deepEqual(penalties.shootoutScores, {away:4,home:2});
    const secondLeg = body.events.find((event: live.LiveEvent) => event.league === 'ucl' && event.id === '733613');
    assert.deepEqual([secondLeg.away.score,secondLeg.home.score,secondLeg.winner], [2,3,'home']);
    assert.deepEqual(secondLeg.soccerAggregate, {away:5,home:4,leg:2,totalLegs:2,advances:'away'});
  } finally { globalThis.fetch = original; }
});

test('board HTTP errors preserve per-league failure metadata and hide unexpected exception details', async () => {
  const { createSportsHandlers } = await import('../app/api/sports/handlers');
  const board: live.LiveBoard = { events: [], leagues: [{ id: 'nfl', sport: 'football', name: 'NFL', status: 'error', error: 'ESPN HTTP 503' }], fetchedAt: '2026-11-15T19:00:00.000Z', source: 'ESPN', refreshAfterMs: 15_000, stale: false };
  for (const error of [new live.LiveSportsError('ESPN scoreboards unavailable', 502, board), new Error('secret filesystem path')]) {
    const handlers = createSportsHandlers({ getLiveBoard: async () => { throw error; }, getLiveEvent: async () => null });
    const response = await handlers.board();
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.source, 'ESPN');
    assert.ok(body.error);
    assert.ok(!JSON.stringify(body).includes('secret filesystem'));
    if (error instanceof live.LiveSportsError) assert.deepEqual(body.board, board);
  }
});

test('event HTTP endpoint returns a real event, explicit missing response, validation errors, and upstream failure', async () => {
  const { createSportsHandlers } = await import('../app/api/sports/handlers');
  const event = live.normalizeScoreboard('nfl', fixtures.nfl)[0];
  let mode: 'ok' | 'missing' | 'failed' = 'ok';
  let calls = 0;
  const handlers = createSportsHandlers({ getLiveBoard: async () => { throw new Error('unused'); }, getLiveEvent: async (key, id) => {
    calls++; assert.equal(key, 'nfl'); assert.equal(id, event.id);
    if (mode === 'failed') throw new live.LiveSportsError('ESPN HTTP 503');
    return mode === 'missing' ? null : event;
  } });
  const request = () => new Request(`http://localhost/api/sports/event?league=nfl&id=${event.id}`);
  const success = await handlers.event(request());
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), event);
  mode = 'missing'; assert.equal((await handlers.event(request())).status, 404);
  mode = 'failed'; assert.equal((await handlers.event(request())).status, 502);
  for (const query of ['', '?league=nfl', '?league=bad&id=1', '?league=nfl&id=../1', '?league=nfl&league=nba&id=1', '?league=nfl&id=1&id=2']) {
    const response = await handlers.event(new Request(`http://localhost/api/sports/event${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 3);
  const route = await import('../app/api/sports/event/route');
  assert.equal((await route.GET(new Request('http://localhost/api/sports/event'))).status, 400);
});

test('resolves a team event from a real summary and coalesces the scheduled detail cache', async () => {
  let clock = Date.parse('2026-11-15T19:00:00Z');
  let calls = 0;
  const client = live.createLiveSportsClient({ now: () => clock, fetch: async input => {
    assert.equal(String(input), summaries.nfl._source);
    calls++;
    return Response.json(summaries.nfl);
  } });
  assert.equal(typeof live.getLiveEvent, 'function');
  const [first, concurrent] = await Promise.all([client.getLiveEvent('nfl', '401873064'), client.getLiveEvent('nfl', '401873064')]);
  assert.deepEqual(first, concurrent);
  assert.equal(first!.id, '401873064');
  assert.equal(first!.home.name, 'Cincinnati Bengals');
  assert.equal(first!.away.name, 'Pittsburgh Steelers');
  assert.equal(first!.clock, '14:47');
  assert.equal(calls, 1);
  first!.home.name = 'caller edit';
  assert.equal((await client.getLiveEvent('nfl', '401873064'))!.home.name, 'Cincinnati Bengals');
  clock += 15_000;
  await client.getLiveEvent('nfl', '401873064');
  assert.equal(calls, 2);
});

test('game summaries join stats by team id and keep scoreless or missing values distinct', async () => {
  const header = summaries.nfl.header;
  const game = live.normalizeScoreboard('nfl', {events: [header]})[0];
  const stat = (name: string, displayValue: string) => ({name, label: 'Total yards', displayValue});
  const payload = {
    header,
    boxscore: {teams: [
      {team: {id: game.home.id}, statistics: [stat('totalYards', '0')]},
      {team: {id: '9999'}, statistics: [stat('totalYards', '999')]},
      {team: {id: game.away.id}, statistics: [stat('totalYards', '128'), stat('empty', '')]},
    ]},
    scoringPlays: [
      {id: '100', text: 'Field goal', team: {id: game.home.id}, clock: {displayValue: '2:14'}, period: {number: 1}, awayScore: 0, homeScore: 3},
      {id: '101', text: 'Touchdown', team: {id: game.away.id}, awayScore: 6, homeScore: 3},
      {id: 'invalid', text: 'Omit invalid id'},
    ],
  };
  const client = live.createLiveSportsClient({fetch: async () => Response.json(payload)});
  const result = await client.getLiveEvent('nfl', game.id);
  assert.deepEqual(result?.teamStats, [{key: 'totalYards', label: 'Total yards', away: '128', home: '0'}]);
  assert.deepEqual(result?.scoringPlays?.map(play => [play.id, play.side, play.awayScore, play.homeScore]), [
    ['101', 'away', 6, 3], ['100', 'home', 0, 3],
  ]);
});

test('player box scores match teams by ID and keep statistics under the correct columns', async () => {
  const header = summaries.nfl.header;
  const game = live.normalizeScoreboard('nfl', {events: [header]})[0];
  const player = (id: string, stats: (string | number)[], didNotPlay = false) => ({
    athlete: {id, displayName: `Player ${id}`}, stats, didNotPlay,
  });
  const group = (type: string, athletes: ReturnType<typeof player>[]) => ({
    type, labels: ['YDS', 'TD'], athletes,
  });
  const client = live.createLiveSportsClient({fetch: async () => Response.json({
    header, boxscore: {players: [
      {team: {id: game.home.id}, statistics: [group('rushing', [player('20', [40, 1])])]},
      {team: {id: game.away.id}, statistics: [group('passing', [
        player('21', ['250', 0]), player('22', ['75']), player('23', ['0', '0'], true),
      ])]},
    ]},
  })});
  const result = await client.getLiveEvent('nfl', game.id);
  assert.deepEqual(result?.playerStats?.away, [{
    name: 'passing', columns: ['YDS', 'TD'], players: [{id: '21', name: 'Player 21', values: ['250', '0']}],
  }]);
  assert.equal(result?.playerStats?.home[0].players[0].id, '20');
});

test('football timeline combines completed and current drives newest first without repeating plays', async () => {
  const header = summaries.nfl.header;
  const game = live.normalizeScoreboard('nfl', {events: [header]})[0];
  const first = {id: '100', text: 'First play', period: {number: 1}, awayScore: 0, homeScore: 0};
  const latest = {id: '101', text: 'Latest play', period: {number: 2}, awayScore: 3, homeScore: 0};
  const client = live.createLiveSportsClient({fetch: async () => Response.json({
    header, drives: {previous: [{plays: [first, latest]}], current: {plays: [latest]}},
  })});
  const result = await client.getLiveEvent('nfl', game.id);
  assert.deepEqual(result?.timeline?.map(play => [play.id, play.period, play.awayScore]), [
    ['101', 2, 3], ['100', 1, 0],
  ]);
});

test('soccer timeline keeps provider key events and scores only flagged goals', async () => {
  const header = summaries.nfl.header;
  const game = live.normalizeScoreboard('ucl', {events: [header]})[0];
  const keyEvents = [
    {id:'100', type:{text:'Kickoff'}},
    {id:'101', text:'Yellow card for the home side', team:{id:game.home.id}, clock:{displayValue:"17'"}},
    {id:'102', text:'Goal for the away side', scoringPlay:true, team:{id:game.away.id}, clock:{displayValue:"45'+2'"}},
    {id:'103', shortText:'Substitution', scoringPlay:false, period:{number:2}},
  ];
  const commentary = [
    {sequence: 0, text: 'Kickoff'},
    {sequence: 2, text: 'Stoppage', time: {displayValue:"45'+2'"}},
    {sequence: 1, text: 'Open play'},
    {sequence: -1, text: 'Ignore'},
    {sequence: 3, text: ' '},
  ];
  const client = live.createLiveSportsClient({fetch: async () => Response.json({header, keyEvents, commentary})});
  const result = await client.getLiveEvent('ucl', game.id);
  assert.deepEqual(result?.timeline?.map(event => event.id), ['103','102','101']);
  assert.deepEqual(result?.soccerCommentary, [
    {sequence:2,description:'Stoppage',clock:"45'+2'"},
    {sequence:1,description:'Open play',clock:null},
    {sequence:0,description:'Kickoff',clock:null},
  ]);
  assert.deepEqual(result?.scoringPlays, [{
    id:'102', description:'Goal for the away side', side:'away', period:null, clock:"45'+2'",
    awayScore:null, homeScore:null,
  }]);
});

test('soccer standings preserve provider rank and signed values for relevant groups', async () => {
  const header = summaries.nfl.header;
  const game = live.normalizeScoreboard('ucl', {events:[header]})[0];
  const entry = (id:string, team:string, rank:number, points:number) => ({
    id, team, stats:[{name:'rank',value:rank},{name:'points',value:points},
      {name:'gamesPlayed',value:10},{name:'pointDifferential',value:-4}],
  });
  const standings = {header:'Table',groups:[
    {header:'League phase',standings:{entries:[
      entry(game.home.id,'Home',7,12),entry('9944','A club',1,24),entry(game.away.id,'Away',11,-1),
      entry(game.away.id,'Duplicate',2,80),entry('ABC','Invalid',3,20),
    ]}},
    {header:'Unrelated group',standings:{entries:[entry('9954','Another club',1,50)]}},
  ]};
  const client = live.createLiveSportsClient({fetch:async()=>Response.json({header,standings})});
  const result = await client.getLiveEvent('ucl',game.id);
  assert.deepEqual(result?.soccerStandings?.map(group=>[group.title,group.rows.map(row=>[row.rank,row.name,row.goalDifference,row.points])]),
    [['League phase',[[1,'A club',-4,24],[7,'Home',-4,12],[11,'Away',-4,-1]]]]);
});

test('NBA standings keep ESPN order and only include divisions tied to the matchup', async () => {
  const header = fixtures.nba.events[0];
  const game = live.normalizeScoreboard('nba',{events:[header]})[0];
  const entry = (id:string,team:string,record:Record<string,number>) => ({
    id,team,stats:Object.entries(record).map(([name,value])=>({name,value})),
  });
  const standings = {groups:[
    {header:'Pacific standings',standings:{entries:[
      entry('9944','Division leader',{wins:12,losses:2,winPercent:.85714287,gamesBehind:0}),
      entry(game.home.id,'Home team',{wins:8,losses:6,winPercent:.571,gamesBehind:4}),
      entry(game.home.id,'Duplicate',{wins:90}),
    ]}},
    {header:'Northwest standings',standings:{entries:[
      entry(game.away.id,'Away team',{wins:4,losses:1.5,winPercent:1.1,gamesBehind:1.5}),
    ]}},
    {header:'Unrelated standings',standings:{entries:[entry('9954','Another team',{wins:7})]}},
  ]};
  const client = live.createLiveSportsClient({fetch:async()=>Response.json({header,standings})});
  const result = await client.getLiveEvent('nba',game.id);
  assert.deepEqual(result?.nbaStandings,[
    {title:'Pacific standings',rows:[
      {teamId:'9944',name:'Division leader',wins:12,losses:2,winPercent:.85714287,gamesBehind:0},
      {teamId:game.home.id,name:'Home team',wins:8,losses:6,winPercent:.571,gamesBehind:4},
    ]},
    {title:'Northwest standings',rows:[
      {teamId:game.away.id,name:'Away team',wins:4,losses:null,winPercent:null,gamesBehind:1.5},
    ]},
  ]);
});

test('NHL live lineup joins active athlete IDs only to the matching team roster', async () => {
  const header = structuredClone(fixtures.nhl.events[0]);
  const competition = header.competitions[0];
  competition.status.type = {name:'STATUS_IN_PROGRESS',state:'in',completed:false};
  const [game] = live.normalizeScoreboard('nhl',{events:[header]});
  const active = (athleteid:string) => ({athleteid,whereabouts:{name:'ROSTER_WHEREABOUTS_IN_PLAY'}});
  const data = {header,onIce:[
    {teamId:game.away.id,entries:[active('101'),active('101'),active('302'),{athleteid:'303',whereabouts:{name:'ON_BENCH'}}]},
    {teamId:game.home.id,entries:[active('302')]},
  ],boxscore:{players:[
    {team:{id:game.away.id},statistics:[{athletes:[
      {athlete:{id:'101',displayName:'Away center',jersey:'0',position:{abbreviation:'C'}}},
      {athlete:{id:'303',displayName:'Benched player'}},
    ]}]},
    {team:{id:game.home.id},statistics:[{athletes:[
      {athlete:{id:'302',displayName:'Home goalie',position:{abbreviation:'G'}}},
    ]}]},
  ]}};
  const client = () => live.createLiveSportsClient({fetch:async()=>Response.json(data)});
  const result = await client().getLiveEvent('nhl',game.id);
  assert.deepEqual(result?.onIce,{
    away:[{id:'101',name:'Away center',jersey:'0',position:'C'}],
    home:[{id:'302',name:'Home goalie',position:'G'}],
  });
  competition.status.type = {name:'STATUS_FINAL',state:'post',completed:true};
  assert.equal((await client().getLiveEvent('nhl',game.id))?.onIce,undefined);
});

test('NFL and NHL standings validate their league-specific columns', async () => {
  for (const [league, stats, expected] of [
    ['nfl', {wins:8, losses:2, ties:0, pointsFor:251, pointsAgainst:-1}, {ties:0, pointsFor:251, pointsAgainst:null}],
    ['nhl', {wins:8, losses:2, otLosses:2, points:18}, {otLosses:2, points:18}],
  ] as const) {
    const header = fixtures[league].events[0];
    const game = live.normalizeScoreboard(league,{events:[header]})[0];
    const entry = (id:string, team:string) => ({
      id, team, stats:Object.entries(stats).map(([name,value])=>({name,value})),
    });
    const standings = {groups:[
      {header:'Matchup division',standings:{entries:[entry(game.home.id,'Home'),entry(game.away.id,'Away')]}},
      {header:'Unrelated',standings:{entries:[entry('9999','Other')]}},
    ]};
    const client = live.createLiveSportsClient({fetch:async()=>Response.json({header,standings})});
    const result = await client.getLiveEvent(league,game.id);
    assert.deepEqual(result?.recordStandings,[{title:'Matchup division',rows:[
      {teamId:game.home.id,name:'Home',wins:8,losses:2,winPercent:null,gamesBehind:null,...expected},
      {teamId:game.away.id,name:'Away',wins:8,losses:2,winPercent:null,gamesBehind:null,...expected},
    ]}]);
  }
});

test('MLB probable starters keep each team’s identity and validated pitching figures', async () => {
  const header = structuredClone(summaries.nfl.header);
  const [home, away] = ['home','away'].map(side =>
    header.competitions[0].competitors.find((item: {homeAway:string})=>item.homeAway===side));
  const athlete = {id:'42584',displayName:'Drew Rasmussen',throws:{abbreviation:'R'},
    headshot:{href:'https://a.espncdn.com/i/headshots/mlb/players/full/42584.png'}};
  const starter = {name:'probableStartingPitcher',playerId:42584,athlete,statistics:{splits:{categories:[
    {name:'ERA',value:2.1976},{name:'WHIP',value:-1},{name:'strikeouts',value:0},
  ]}}};
  home.probables = [starter];
  away.probables = [{...starter,playerId:101}];
  const client = live.createLiveSportsClient({fetch:async()=>Response.json({header})});
  const event = await client.getLiveEvent('mlb',header.competitions[0].id);
  assert.deepEqual(event?.probablePitchers,{home:{
    id:'42584', name:'Drew Rasmussen', hand:'R', headshot:athlete.headshot.href,
    era:2.1976,whip:null,strikeouts:0,
  }});
  assert.equal((await client.getLiveEvent('nfl',header.competitions[0].id))?.probablePitchers,undefined);
});

test('MLB line scores keep hits, errors and confirmed pitching decisions', async () => {
  const header = structuredClone(summaries.nfl.header);
  const competition = header.competitions[0];
  const home = competition.competitors.find((side:{homeAway:string})=>side.homeAway==='home');
  const away = competition.competitors.find((side:{homeAway:string})=>side.homeAway==='away');
  Object.assign(home,{hits:8,errors:0,winner:true});
  Object.assign(away,{hits:'7',errors:-1,winner:false});
  const pitcher = (name:string,id:string,teamId:string,displayName:string) => ({
    name, playerId:Number(id), team:{id:teamId}, athlete:{id,displayName},
  });
  competition.status = {type:{name:'STATUS_FINAL', state:'post', completed:true},featuredAthletes:[
    pitcher('winningPitcher','39945',home.id,'Brock Burke'),
    pitcher('losingPitcher','40917',away.id,'Adrian Morejon'),
    pitcher('savingPitcher','33403',home.id,'Emilio Pagan'),
  ]};
  const [result] = live.normalizeScoreboard('mlb',{events:[header]});
  assert.deepEqual(result.home.baseballTotals,{hits:8,errors:0});
  assert.deepEqual(result.away.baseballTotals,{hits:7,errors:null});
  assert.deepEqual(result.pitchingDecisions,[
    {kind:'win',name:'Brock Burke',side:'home'},
    {kind:'loss',name:'Adrian Morejon',side:'away'},
    {kind:'save',name:'Emilio Pagan',side:'home'},
  ]);
  competition.status.featuredAthletes[2].team.id = away.id;
  assert.equal(live.normalizeScoreboard('mlb',{events:[header]})[0].pitchingDecisions?.length,2);
  competition.status.type = {name:'STATUS_IN_PROGRESS',state:'in',completed:false};
  assert.equal(live.normalizeScoreboard('mlb',{events:[header]})[0].pitchingDecisions,undefined);
});

test('grouped baseball stats keep categories distinct and use scoring plays from play-by-play', async () => {
  const header = summaries.nfl.header;
  const game = live.normalizeScoreboard('mlb', {events: [header]})[0];
  const category = (name: string, displayName: string, hits: string) => ({
    name, displayName, stats: [{name: 'hits', displayName: 'Hits', displayValue: hits}],
  });
  const client = live.createLiveSportsClient({fetch: async () => Response.json({
    header,
    boxscore: {teams: [{team: {id: game.away.id}, statistics: [
      category('batting', 'Batting', '7'), category('pitching', 'Pitching', '4'), category('constructor', 'Ignore', '9'),
    ]}]},
    plays: [
      {id: '4019080461704990056', text: 'Foul ball', scoringPlay: false},
      {id: '4019080461704990057', text: 'Double, runner scores', scoringPlay: true, awayScore: 0, homeScore: 1},
    ],
  })});
  const result = await client.getLiveEvent('mlb', game.id);
  assert.deepEqual(result?.teamStats, [
    {key: 'batting:hits', label: 'Batting · Hits', away: '7', home: null},
    {key: 'pitching:hits', label: 'Pitching · Hits', away: '4', home: null},
  ]);
  assert.deepEqual(result?.scoringPlays?.map(play => play.id), ['4019080461704990057']);
});

test('matchup details preserve team perspective and prevent future games or outdated injury rows', async () => {
  const header = structuredClone(summaries.nfl.header);
  const game = live.normalizeScoreboard('nfl', {events: [header]})[0];
  const pastDate = new Date(Date.parse(game.startsAt) - 86_400_000).toISOString();
  const earlierDate = new Date(Date.parse(pastDate) - 86_400_000).toISOString();
  for (const team of header.competitions[0].competitors) {
    team.record = [{type: 'home', summary: '9-0'}, {type: 'total', summary: team.id === game.away.id ? '6-3' : '5-4'}];
  }
  const past = {
    id: '100', gameDate: pastDate, homeTeamId: '900', awayTeamId: game.away.id,
    opponent: {displayName: 'Recent opponent'}, gameResult: 'W', homeTeamScore: '0', awayTeamScore: '17',
  };
  const payload = {
    header,
    lastFiveGames: [
      {team: {id: game.home.id}, events: []},
      {team: {id: game.away.id}, events: [past, {...past, id: '101', gameDate: game.startsAt}]},
    ],
    injuries: [
      {team: {id: '900'}, injuries: [{athlete: {id: '11', displayName: 'Other team player'}, status: 'Out'}]},
      {team: {id: game.away.id}, injuries: [
        {athlete: {id: '12', displayName: 'Away player'}, status: 'Questionable', date: earlierDate},
        {athlete: {id: '12', displayName: 'Away player'}, status: 'Out', date: pastDate, details: {type: 'Ankle'}},
      ]},
    ],
    seasonseries: [{summary: 'Series tied 1-1', events:[
      {id:'109',date:game.startsAt,statusType:{state:'pre'},competitors:[
        {homeAway:'home',team:{id:game.away.id},score:'0'},
        {homeAway:'away',team:{id:game.home.id},score:'0'},
      ]},
      {id:'108',date:pastDate,statusType:{state:'post',name:'STATUS_FINAL',completed:true},competitors:[
        {homeAway:'home',team:{id:game.home.id},score:'23'},
        {homeAway:'away',team:{id:game.away.id},score:'11'},
      ]},
      {id:'107',date:pastDate,statusType:{state:'pre'},competitors:[
        {homeAway:'home',team:{id:game.home.id}},
        {homeAway:'away',team:{id:'9999'}},
      ]},
    ]}],
  };
  const client = live.createLiveSportsClient({fetch: async () => Response.json(payload)});
  const result = await client.getLiveEvent('nfl', game.id);
  assert.equal(result?.matchup?.series, 'Series tied 1-1');
  assert.deepEqual(result?.matchup?.seriesGames?.map(row=>[row.id,row.awayName,row.homeName,row.state,row.score]), [
    ['108',game.away.shortName,game.home.shortName,'final','11–23'],
    ['109',game.home.shortName,game.away.shortName,'scheduled',null],
  ]);
  assert.equal(result?.matchup?.home.record, '5-4');
  assert.deepEqual(result?.matchup?.away.recent.map(row => [row.id, row.away, row.score]), [['100', true, '17–0']]);
  assert.deepEqual(result?.matchup?.away.injuries.map(row => [row.name, row.status, row.reportedAt]), [['Away player', 'Out', pastDate]]);
  assert.deepEqual(result?.matchup?.home.injuries, []);
});

test('detail validation and identity checks fail closed before accepting upstream data', async () => {
  let calls = 0;
  let response: () => Response = () => Response.json(summaries.nfl);
  const client = live.createLiveSportsClient({ fetch: async () => { calls++; return response(); } });
  for (const [league, id] of [['../nfl', '401873064'], ['nfl', '../secret'], ['nfl', '1&event=2'], ['nfl', ''], ['pga', '401850980']]) {
    await assert.rejects(client.getLiveEvent(league, id), (e: any) => e.status === 400);
  }
  assert.equal(calls, 0);
  await assert.rejects(client.getLiveEvent('nfl', '123456'), /identity mismatch/);
  response = () => new Response(null, { status: 404 });
  assert.equal(await client.getLiveEvent('nfl', '123456'), null);
  response = () => Response.json({ header: {} });
  await assert.rejects(client.getLiveEvent('nfl', '123457'), /Invalid ESPN/);
});

test('PGA normalizes an actual multi-player leaderboard without inventing home/away or a winner', () => {
  const events = live.normalizeGolfScoreboard(fixtures.pga);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, '401850980');
  assert.equal(events[0].leaderboard[0].name, 'Trace Crowe');
  assert.equal(events[0].leaderboard[0].score, -14);
  assert.ok(events[0].leaderboard.length > 2);
  assert.equal(events[0].completed, false);
  assert.equal('home' in events[0], false);
  assert.equal('winner' in events[0], false);
  assert.deepEqual(live.normalizeGolfScoreboard({ events: [] }), []);
  assert.throws(() => live.normalizeGolfScoreboard({}), /Invalid ESPN/);
});

test('real tennis empty draws and future TBD placeholders do not invalidate known matches', () => {
  const captured = JSON.parse(readFileSync(new URL('./fixtures/live-sports/tennis-edge-cases.json', import.meta.url), 'utf8'));
  for (const key of ['atp', 'wta']) {
    const events = live.normalizeScoreboard(key, captured[key]);
    assert.equal(events.length, key === 'atp' ? 2 : 1);
    assert.ok(events.every(event => event.home.name !== 'TBD' && event.away.name !== 'TBD'));
    assert.ok(events.every(event => !event.home.id.startsWith('-') && !event.away.id.startsWith('-')));
  }
});

test('tennis normalization preserves set winners and tiebreaks independently of the match score', () => {
  const payload = structuredClone(fixtures.atp);
  const match = payload.events[0].groupings[0].competitions[0];
  const home = match.competitors.find((side: {homeAway:string}) => side.homeAway === 'home');
  delete home.score;
  home.linescores = [{value:7,tiebreak:10,winner:true},{value:2,winner:false},{value:0,tiebreak:-1}];
  const event = live.normalizeScoreboard('atp', payload).find(item=>item.id===match.id);
  assert.equal(event?.home.score, null);
  assert.deepEqual(event?.home.linescores,[7,2,0]);
  assert.deepEqual(event?.home.tennisSetDetails,[
    {tiebreak:10,winner:true},{tiebreak:null,winner:false},{tiebreak:null,winner:null},
  ]);
});

test('UFC normalization retains fight card, venue, format and fighter records on the exact bout', () => {
  const payload = structuredClone(fixtures.ufc);
  const card = payload.events[0];
  const bout = card.competitions[0];
  bout.venue = {fullName:'ABHA Arena',address:{city:'Doha',country:'Qatar'}};
  bout.type = {abbreviation:'Light Heavyweight'};
  bout.format = {regulation:{periods:5}};
  bout.competitors[0].order = 1;
  bout.competitors[0].records = [{type:'total',summary:'32-6-1'}];
  bout.competitors[1].order = 2;
  const event = live.normalizeScoreboard('ufc',payload).find(item=>item.id===bout.id);
  assert.equal(event?.venue,'ABHA Arena');
  assert.deepEqual(event?.fight,{
    cardId:card.id,cardName:card.name,order:0,weightClass:'Light Heavyweight',rounds:5,
    location:'Doha, Qatar',records:{away:undefined,home:'32-6-1'},
  });
});

for (const league of ['atp', 'wta', 'ufc']) {
  test(`${league} detail uses real match/bout IDs on scoreboard, never a tournament/card summary`, async () => {
    let clock = Date.parse('2026-11-15T19:00:00Z');
    let failing = false;
    const config = live.LIVE_LEAGUES.find(l => l.id === league)!;
    const expected = live.normalizeScoreboard(league, fixtures[league])[0];
    const client = live.createLiveSportsClient({ now: () => clock, fetch: async input => {
      const query = league === 'ufc' ? '?dates=20261101-20261227' : '';
      assert.equal(String(input), `https://site.api.espn.com/apis/site/v2/sports/${config.path}/scoreboard${query}`);
      if (failing) return new Response(null, { status: 503 });
      return Response.json(fixtures[league]);
    } });
    assert.deepEqual(await client.getLiveEvent(league, expected.id), expected);
    assert.equal(await client.getLiveEvent(league, '999999999'), null);
    failing = true; clock += 15_000;
    await assert.rejects(client.getLiveEvent(league, expected.id), /503/, 'details never serve stale cached results to picks');
  });
}

test('UFC completed bouts keep confirmed winner and judge scorecards separate from period scores', () => {
  const payload = structuredClone(fixtures.ufc);
  const bout = payload.events[0].competitions[0];
  bout.status = {period:5,displayClock:'5:00',type:{name:'STATUS_FINAL',state:'post',completed:true}};
  for (const [index,competitor] of bout.competitors.entries()) {
    competitor.order = index + 1;
    competitor.winner = index === 0;
    const value = competitor.winner ? 48 : 47;
    competitor.linescores = [{value:value*3,period:0,linescores:Array.from({length:3},()=>({value,period:0}))}];
  }
  const event = live.normalizeScoreboard('ufc',payload).find(item=>item.id===bout.id);
  assert.equal(event?.winner,'home');
  assert.equal(event?.completed,true);
  assert.equal(event?.home.linescores,undefined);
  assert.deepEqual(event?.fight?.scorecards,{home:[48,48,48],away:[47,47,47]});
});

test('soccer summary joins lineups by team ID and preserves only published starters and substitutes', async ()=>{
  const header=structuredClone(fixtures.epl.events[0]);
  const competition=header.competitions[0];
  const home=competition.competitors.find((team:{homeAway:string})=>team.homeAway==='home');
  const away=competition.competitors.find((team:{homeAway:string})=>team.homeAway==='away');
  const starter={starter:true,jersey:'1',athlete:{id:'134283',displayName:'First keeper'},position:{displayName:'Goalkeeper'}};
  const bench={starter:false,subbedIn:true,jersey:12,athlete:{id:'134284',displayName:'Substitute'}};
  const rosters=[
    {team:{id:away.id},formation:'4-2-2-1',roster:[{...starter,athlete:{id:'134285',displayName:'Second keeper'}}]},
    {team:{id:'99909'},formation:'4-3-3',roster:[{...starter,athlete:{id:'134286',displayName:'Unknown team'}}]},
    {team:{id:home.id},formation:'4-3-3',roster:[starter,starter,bench,{athlete:{id:'134287',displayName:'Unconfirmed player'}}]},
  ];
  const client=live.createLiveSportsClient({fetch:async()=>Response.json({header,rosters})});
  const event=await client.getLiveEvent('epl',competition.id);
  assert.equal(event?.soccerLineups?.home?.formation,'4-3-3');
  assert.deepEqual(event?.soccerLineups?.home?.starters.map(player=>player.name),['First keeper']);
  assert.deepEqual(event?.soccerLineups?.home?.bench,[{id:'134284',name:'Substitute',jersey:'12',position:'',subbedIn:true}]);
  assert.deepEqual(event?.soccerLineups?.away?.starters.map(player=>player.name),['Second keeper']);
  assert.equal(event?.soccerLineups?.away?.formation,'');
});

test('normalizes an actually retrieved NFL scoreboard with stable identity and provider attribution', () => {
  assert.equal(typeof live.normalizeScoreboard, 'function');
  const events = live.normalizeScoreboard('nfl', fixtures.nfl);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.id, '401873064');
  assert.equal(event.league, 'nfl');
  assert.equal(event.sport, 'football');
  assert.equal(event.home.name, 'Cincinnati Bengals');
  assert.equal(event.away.name, 'Pittsburgh Steelers');
  assert.equal(event.status, 'live');
  assert.equal(event.winner, null);
  assert.equal(event.completed, false);
  assert.match(event.providerUrl!, /^https:\/\/www\.espn\.com\//);
  assert.equal(event.clock, '8:06');
});

for (const [league, sport] of Object.entries({ ncaaf: 'football', nba: 'basketball', wnba: 'basketball', mlb: 'baseball', nhl: 'hockey', epl: 'soccer', laliga: 'soccer', atp: 'tennis', wta: 'tennis', ufc: 'mma' })) {
  test(`normalizes retrieved ${league} contests without inventing participants`, () => {
    const events = live.normalizeScoreboard(league, fixtures[league]);
    assert.ok(events.length > 0);
    assert.equal(new Set(events.map(event => event.id)).size, events.length);
    for (const event of events) {
      assert.equal(event.sport, sport);
      assert.equal(event.league, league);
      assert.ok(event.home.name && event.away.name);
      assert.ok(event.home.id !== event.away.id);
      if (sport === 'tennis' || sport === 'mma') {
        assert.equal(event.home.score, null, 'do not invent aggregate scores from sets or fight results');
        assert.notEqual(event.id, fixtures[league].events[0].id, 'use actual match/fight, not tournament/card id');
      }
    }
  });
}

test('only authoritative completed final contests declare a winner', () => {
  const data = structuredClone(fixtures.nba);
  const competition = data.events[0].competitions[0];
  const winningSide = competition.competitors.find((c: any) => c.winner === true).homeAway;
  assert.equal(live.normalizeScoreboard('nba', data)[0].winner, winningSide);
  for (const [name, state, complete, expected] of [
    ['STATUS_CANCELED', 'post', true, 'cancelled'],
    ['STATUS_POSTPONED', 'pre', false, 'postponed'],
    ['STATUS_SUSPENDED', 'post', false, 'unknown'],
    ['STATUS_NO_CONTEST', 'post', true, 'unknown'],
    ['STATUS_FINAL', 'post', false, 'unknown'],
    ['STATUS_FINAL', 'pre', true, 'unknown'],
    ['UNRECOGNIZED', 'pre', false, 'unknown'],
  ] as const) {
    competition.status.type = { name, state, completed: complete, description: name };
    const event = live.normalizeScoreboard('nba', data)[0];
    assert.equal(event.status, expected, name);
    assert.equal(event.winner, null, name);
    assert.equal(event.completed, false, name);
  }
});

test('does not infer a draw or winner from scores or contradictory flags', () => {
  const data = structuredClone(fixtures.nba);
  const competition = data.events[0].competitions[0];
  for (const competitor of competition.competitors) { competitor.score = '10'; delete competitor.winner; }
  assert.equal(live.normalizeScoreboard('nba', data)[0].winner, null);
  competition.competitors.forEach((c: any) => { c.winner = true; });
  assert.equal(live.normalizeScoreboard('nba', data)[0].winner, null);
});

test('distinguishes empty schedules from invalid payloads and unsupported golf leaderboards', () => {
  assert.deepEqual(live.normalizeScoreboard('nfl', { events: [] }), []);
  for (const data of [{}, { events: null }, { events: [{}] }]) assert.throws(() => live.normalizeScoreboard('nfl', data), /Invalid ESPN/);
  const missingParticipant = structuredClone(fixtures.nfl);
  missingParticipant.events[0].competitions[0].competitors.pop();
  assert.throws(() => live.normalizeScoreboard('nfl', missingParticipant), /Invalid ESPN/);
  assert.throws(() => live.normalizeScoreboard('pga', fixtures.pga), /leaderboard.*two-sided/i);
});

test('rejects unapproved league keys and filters unsafe upstream identifiers and asset links', () => {
  assert.throws(() => live.normalizeScoreboard('../nfl', fixtures.nfl), /league/i);
  const data = structuredClone(fixtures.nfl);
  data.events[0].links.forEach((link: any) => { link.href = 'https://www.espn.com.evil.test/steal'; });
  data.events[0].competitions[0].competitors[0].team.logo = 'javascript:alert(1)';
  const event = live.normalizeScoreboard('nfl', data)[0];
  assert.equal(event.providerUrl, undefined);
  assert.equal(event.home.logo, undefined);
  data.events[0].competitions[0].id = '../other';
  assert.throws(() => live.normalizeScoreboard('nfl', data), /Invalid ESPN/);
});

test('deduplicates repeated provider records by league and actual competition id', () => {
  const data = structuredClone(fixtures.nfl);
  data.events.push(structuredClone(data.events[0]));
  assert.equal(live.normalizeScoreboard('nfl', data).length, 1);
});

test('board coalesces requests and refreshes active leagues ahead of idle leagues', async () => {
  let clock = Date.parse('2026-11-15T19:00:00Z');
  let calls = 0;
  let active = 0;
  let maximum = 0;
  const client = live.createLiveSportsClient({ now: () => clock, fetch: async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://site.api.espn.com');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal);
    const config = live.LIVE_LEAGUES.find(l => url.pathname.endsWith(`${l.path}/scoreboard`))!;
    assert.ok(config);
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return Response.json(fixtures[config.id]);
  } });
  const [first, concurrent] = await Promise.all([client.getLiveBoard(), client.getLiveBoard()]);
  assert.deepEqual(first, concurrent);
  assert.equal(calls, live.LIVE_LEAGUES.length);
  assert.ok(maximum <= 4 && maximum > 1);
  assert.equal(first.source, 'ESPN');
  assert.equal(first.refreshAfterMs, 1_500);
  assert.equal(first.stale, false);
  assert.equal(first.leagues.filter(l => l.status === 'ok').length, live.LIVE_LEAGUES.length);
  assert.ok(first.golf?.length);
  first.golf.length = 0;
  assert.ok((await client.getLiveBoard()).golf?.length, 'callers cannot mutate the golf cache');
  first.events.length = 0;
  assert.ok((await client.getLiveBoard()).events.length > 0, 'callers cannot mutate cache');
  const activeLeagues = new Set(concurrent.events.filter(event=>event.status==='live').map(event=>event.league));
  if (concurrent.golf?.some(tournament=>tournament.state==='in')) activeLeagues.add('pga');
  assert.ok(activeLeagues.size > 0 && activeLeagues.size < live.LIVE_LEAGUES.length);
  clock += 1_499;
  await client.getLiveBoard();
  assert.equal(calls, live.LIVE_LEAGUES.length);
  clock++;
  await client.getLiveBoard();
  assert.equal(calls, live.LIVE_LEAGUES.length + activeLeagues.size);
  clock += 6_500;
  await client.getLiveBoard();
  assert.equal(calls, live.LIVE_LEAGUES.length * 2 + activeLeagues.size);
});

test('the event route falls back to the same scoreboard event while pick verification fails closed', async () => {
  const {createSportsHandlers} = await import('../app/api/sports/handlers');
  let clock = Date.parse('2026-11-15T19:00:00Z');
  const game = live.normalizeScoreboard('nfl',fixtures.nfl)[0];
  let scoreboardDown = false;
  const client = live.createLiveSportsClient({now:()=>clock,fetch:async input=>{
    const url = String(input);
    if (url.includes('/summary?') || scoreboardDown) return new Response(null,{status:503});
    return Response.json(url.includes('/football/nfl/') ? fixtures.nfl : {events:[]});
  }});
  const handlers = createSportsHandlers(client);
  const request = (id:string) => new Request(`http://localhost/api/sports/event?league=nfl&id=${id}`);
  await client.getLiveBoard();
  assert.equal((await handlers.event(request('999999999'))).status,502);
  const res = await handlers.event(request(game.id));
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{
    event:game, lastSuccessAt:new Date(clock).toISOString(), stale:true, fallback:'scoreboard',
  });
  await assert.rejects(client.getLiveEvent('nfl',game.id), /HTTP 503/);
  clock += 300_001;
  scoreboardDown = true;
  assert.equal((await handlers.event(request(game.id))).status,502);
});

test('a rate-limited league backs off automatic checks and manual retries', async () => {
  let clock = 10_000;
  let requests = 0;
  const client = live.createLiveSportsClient({now:()=>clock,fetch:async input=>{
    if (!String(input).includes('/football/nfl/')) return Response.json({events:[]});
    requests++;
    return requests===1 ? new Response(null,{status:429}) : Response.json(fixtures.nfl);
  }});
  await client.getLiveBoard();
  await client.getLiveBoard('nfl');
  clock += 15_000;
  await client.getLiveBoard();
  await client.getLiveBoard('nfl');
  assert.equal(requests,1);
  clock += 15_000;
  const board = await client.getLiveBoard();
  assert.equal(requests,2);
  assert.equal(board.leagues.find(league=>league.id==='nfl')?.status,'ok');
});
test('outbound concurrency is shared between board and concurrent event requests', async () => {
  let active = 0;
  let maximum = 0;
  const client = live.createLiveSportsClient({ fetch: async input => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active--;
    return String(input).includes('/summary?') ? new Response(null, { status: 404 }) : Response.json({ events: [] });
  } });
  await Promise.all([client.getLiveBoard(), ...Array.from({ length: 12 }, (_, i) => client.getLiveEvent('nfl', String(1000 + i)))]);
  assert.ok(maximum <= 4, `observed ${maximum} simultaneous requests`);
});

test('an overloaded request queue rejects excess work instead of growing without bound', async () => {
  const client = live.createLiveSportsClient({ fetch: async () => {
    await new Promise(resolve => setTimeout(resolve, 3));
    return new Response(null, { status: 404 });
  } });
  const outcomes = await Promise.allSettled(Array.from({ length: 80 }, (_, i) => client.getLiveEvent('nfl', String(2000 + i))));
  const rejected = outcomes.filter(result => result.status === 'rejected');
  assert.ok(rejected.length > 0);
  assert.ok(rejected.every(result => result.status === 'rejected' && result.reason.status === 503));
});

test('failed refreshes expose per-league stale data with original timestamp, then expire it', async () => {
  let clock = Date.parse('2026-11-15T19:00:00Z');
  let failing = false;
  const client = live.createLiveSportsClient({ now: () => clock, fetch: async input => {
    const isNfl = String(input).includes('/football/nfl/');
    if (failing && isNfl) return new Response('unavailable', { status: 503 });
    return Response.json(isNfl ? fixtures.nfl : { events: [] });
  } });
  const fresh = await client.getLiveBoard();
  failing = true; clock += 15_000;
  const stale = await client.getLiveBoard();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, fresh.fetchedAt, 'do not relabel old data as freshly fetched');
  assert.deepEqual(stale.events, fresh.events);
  assert.equal(stale.leagues.find(l => l.id === 'nfl')!.status, 'stale');
  assert.match(stale.leagues.find(l => l.id === 'nfl')!.error!, /503/);
  clock += 300_000;
  const expired = await client.getLiveBoard();
  assert.equal(expired.events.length, 0);
  assert.equal(expired.leagues.find(l => l.id === 'nfl')!.status, 'error');
});

for (const [name, response, pattern] of [
  ['HTTP failure', () => new Response('unavailable', { status: 503 }), /HTTP 503/],
  ['HTML bot wall', () => new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } }), /non-JSON/],
  ['malformed JSON', () => new Response('{bad', { headers: { 'content-type': 'application/json' } }), /invalid JSON/],
  ['invalid shape', () => Response.json({ error: 'access denied' }), /events must be an array/],
] as const) {
  test(`cold ${name} is an explicit provider failure, not an empty schedule`, async () => {
    const client = live.createLiveSportsClient({ fetch: async () => response() });
    for (let i = 0; i < 2; i++) {
      await assert.rejects(client.getLiveBoard(), (error: any) => {
        assert.equal(error.status, 502);
        assert.equal(error.board.events.length, 0);
        assert.equal(error.board.leagues.length, live.LIVE_LEAGUES.length);
        assert.ok(error.board.leagues.every((l: any) => l.status === 'error' && pattern.test(l.error)));
        return true;
      });
    }
  });
}

test('single-league retry restores the failed feed and preserves the rest of the slate', async () => {
  const {createSportsHandlers} = await import('../app/api/sports/handlers');
  let clock = Date.parse('2026-11-15T19:00:00Z');
  let nflFails = false;
  const requests: string[] = [];
  const client = live.createLiveSportsClient({now: () => clock, fetch: async input => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    const nfl = url.pathname.endsWith('/football/nfl/scoreboard');
    if (nfl && nflFails) return new Response('unavailable', {status: 503});
    return Response.json(nfl ? fixtures.nfl : {events: []});
  }});
  const handlers = createSportsHandlers(client);
  const request = (query: string) => new Request('http://localhost/api/sports?' + query);
  const initial = await client.getLiveBoard();
  nflFails = true;
  clock += 15_000;
  const interrupted = await client.getLiveBoard();
  assert.equal(interrupted.leagues.find(league => league.id === 'nfl')?.lastSuccessAt, initial.fetchedAt);
  requests.length = 0;
  assert.equal((await handlers.board(request('league=nfl&league=nba'))).status, 400);
  assert.equal((await handlers.board(request('league=unknown'))).status, 400);
  assert.deepEqual(requests, []);
  nflFails = false;
  clock += 1_000;
  const responses = await Promise.all([handlers.board(request('league=nfl')), handlers.board(request('league=nfl'))]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    const recovered: live.LiveBoard = await response.json();
    assert.equal(recovered.stale, false);
    assert.deepEqual(recovered.events, initial.events);
    assert.deepEqual(recovered.leagues.find(league => league.id === 'nfl'), {
      id:'nfl', name:'NFL', sport:'football', status:'ok', lastSuccessAt:new Date(clock).toISOString(),
    });
    assert.deepEqual(recovered.leagues.filter(league => league.id !== 'nfl'),
      interrupted.leagues.filter(league => league.id !== 'nfl'));
  }
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/football\/nfl\/scoreboard$/);
});

test('football field maps the published spot from the away goal and clears invalid data', () => {
  const data = structuredClone(fixtures.nfl);
  const competition = data.events[0].competitions[0];
  const [home, away] = ['home','away'].map(side => competition.competitors.find((entry: {homeAway:string}) => entry.homeAway === side));
  competition.status.type = {name:'STATUS_IN_PROGRESS',state:'in',completed:false};
  const homeName = home.team.abbreviation;
  const awayName = away.team.abbreviation;

  competition.situation = {possession:home.id, shortDownDistanceText:'2nd & 5', possessionText:homeName + ' 25'};
  assert.deepEqual(live.normalizeScoreboard('nfl',data)[0].footballPosition, {
    possession:'home',fieldPercent:75,spot:homeName + ' 25',downAndDistance:'2nd & 5',
  });
  competition.situation.possessionText = awayName + ' 15';
  assert.equal(live.normalizeScoreboard('nfl',data)[0].footballPosition?.fieldPercent,15);
  competition.situation.possessionText = 'UNK 25';
  assert.equal(live.normalizeScoreboard('nfl',data)[0].footballPosition,undefined);
  competition.situation.possessionText = '50';
  assert.equal(live.normalizeScoreboard('nfl',data)[0].footballPosition?.fieldPercent,50);
  competition.status.type.name = 'STATUS_HALFTIME';
  assert.equal(live.normalizeScoreboard('nfl',data)[0].footballPosition,undefined);
});

test('football game detail uses the current drive only when ESPN confirms possession', async () => {
  const header = structuredClone(summaries.nfl.header);
  const payload = {
    header,
    drives:{current:{
      team:{id:'4'},isScore:false,
      plays:[{period:{number:2},scoringPlay:false,
        end:{team:{id:'4'},shortDownDistanceText:'3rd & Goal',possessionText:'PIT 7'}}],
    }},
  };
  const getDetail = () => live.createLiveSportsClient({fetch:async()=>Response.json(payload)}).getLiveEvent('nfl',header.id);
  assert.deepEqual((await getDetail())?.footballPosition, {
    possession:'home',fieldPercent:7,spot:'PIT 7',downAndDistance:'3rd & Goal',
  });
  payload.drives.current.plays[0].end.team.id = '23';
  assert.equal((await getDetail())?.footballPosition,undefined);
});

test('football drives keep the current possession and completed results in provider order', async () => {
  const header = structuredClone(summaries.nfl.header);
  const start = {text:'PIT 40',period:{number:2},clock:{displayValue:'14:47'}};
  const starter = {id:'4018730641',team:{id:'23'},start,offensivePlays:3,yards:-2,timeElapsed:{displayValue:'1:32'}};
  const earlier = {...starter,id:'4018730642',displayResult:'Punt',end:{...start,text:'PIT 38'}};
  const scoring = {
    ...starter,id:'4018730643',team:{id:'4'},isScore:true,displayResult:'Touchdown',
    end:{text:'PIT 0',period:{number:2},clock:{displayValue:'12:15'}},
  };
  const payload = {header,drives:{current:starter,previous:[earlier,scoring,starter,{...scoring,id:'4018730644',team:{id:'99'}}]}};
  const getDetail = () => live.createLiveSportsClient({fetch:async()=>Response.json(payload)}).getLiveEvent('nfl',header.id);
  const drives = (await getDetail())?.footballDrives;
  assert.deepEqual(drives?.map(drive=>[drive.id,drive.result]), [
    ['4018730641',null],['4018730643','Touchdown'],['4018730642','Punt'],
  ]);
  assert.deepEqual(drives?.[1],{
    id:'4018730643',side:'home',result:'Touchdown',scoring:true,plays:3,yards:-2,duration:'1:32',
    from:'PIT 40',to:'PIT 0',period:2,clock:'12:15',
  });
  header.competitions[0].status.type = {name:'STATUS_FINAL',state:'post',completed:true};
  assert.equal((await getDetail())?.footballDrives?.length,2);
});

test('recognizes a regulation soccer draw only with full-time status, equal goals and explicit no-winner flags', () => {
  const data = structuredClone(fixtures.epl);
  const competition = data.events[0].competitions[0];
  competition.status.type = {name:'STATUS_FULL_TIME',state:'post',completed:true,description:'Full Time'};
  for (const side of competition.competitors) {side.score = '1';side.winner = false;}
  for (const league of ['epl','laliga','bundesliga','seriea','ligue1','brasileirao','aleague','nationsleague','concacafnl','afconqual','nwsl','wsl']) {
    assert.equal(live.normalizeScoreboard(league,data)[0].winner,'draw');
  }
  assert.equal(live.normalizeScoreboard('ucl',data)[0].winner,null);
  delete competition.competitors[0].winner;
  assert.equal(live.normalizeScoreboard('epl',data)[0].winner,null);
  competition.competitors[0].winner = false;
  competition.competitors[0].score = '2';
  assert.equal(live.normalizeScoreboard('epl',data)[0].winner,null);
  competition.competitors[0].score = '1';
  competition.status.type = {name:'STATUS_FINAL_SO',state:'post',completed:true,description:'Penalties'};
  assert.equal(live.normalizeScoreboard('epl',data)[0].winner,null);
});

test('scheduled basketball separates season leaders from game statistics', async () => {
  const header = structuredClone(summaries.nfl.header);
  const competition = header.competitions[0];
  competition.status.type = {...competition.status.type,state:'pre',name:'STATUS_SCHEDULED',completed:false};
  const game = live.normalizeScoreboard('nba',{events:[header]})[0];
  const category = (name:string,label:string) => ({name,displayName:label,leaders:[
    {displayValue:'24.5',athlete:{id:'1234',displayName:'Verified player'}},
  ]});
  const leaders = [{team:{id:game.away.id},leaders:[
    category('pointsPerGame','Points'),category('assistsPerGame','Assists'),category('points','Game points'),
  ]}];
  const client = live.createLiveSportsClient({fetch:async()=>Response.json({header,leaders})});
  const result = await client.getLiveEvent('nba',game.id);
  assert.equal(result?.status,'scheduled');
  assert.deepEqual(result?.pregameLeaders?.map(group=>[group.key,group.away[0].value]), [
    ['pointsPerGame','24.5'],['assistsPerGame','24.5'],
  ]);
  assert.equal(result?.leaders,undefined);
  assert.equal(result?.playerStats,undefined);
});

test('game leaders retain provider categories and only the verified matchup teams', async () => {
  const header = structuredClone(summaries.nfl.header);
  const id = header.competitions[0].id;
  const [away, home] = ['away','home'].map(side=>header.competitions[0].competitors.find((row:{homeAway:string})=>row.homeAway===side).id);
  const player = (id:string, name:string, team?:string) => ({
    displayValue:'101 YDS',
    athlete:{id,displayName:name,...(team?{team:{id:team}}:{}),headshot:{href:'https://a.espncdn.com/i/headshots/nfl/players/full/'+id+'.png'}},
  });
  const category = (leaders:ReturnType<typeof player>[]) => ({name:'passingYards',displayName:'Passing Yards',leaders});
  const groups = [
    {team:{id:away},leaders:[category([player('101','Away Leader'),player('101','Duplicate'),player('102','Wrong side',home)])]},
    {team:{id:home},leaders:[category([player('103','Home Leader')])]},
    {team:{id:'99999999'},leaders:[category([player('104','Unrelated Player')])]},
  ];
  const client = live.createLiveSportsClient({fetch:async()=>Response.json({header,leaders:groups})});
  const game = await client.getLiveEvent('nfl',id);
  assert.equal(game?.leaders?.length,1);
  const [leaders] = game!.leaders!;
  assert.equal(leaders.label,'Passing Yards');
  assert.deepEqual(leaders.away.map(player=>[player.name,player.value]),[['Away Leader','101 YDS']]);
  assert.deepEqual(leaders.home.map(player=>player.name),['Home Leader']);
  assert.match(leaders.home[0].headshot ?? '',/espncdn\.com/);
});

test('a cold Game Center link checks only its scoreboard when the summary is unavailable', async () => {
  const {createSportsHandlers} = await import('../app/api/sports/handlers');
  const game = live.normalizeScoreboard('nfl', fixtures.nfl)[0];
  const requests: string[] = [];
  const client = live.createLiveSportsClient({fetch: async input => {
    const url = new URL(String(input));
    requests.push(url.pathname.split('/').pop()!);
    return url.searchParams.has('event') ? new Response(null, {status: 503}) : Response.json(fixtures.nfl);
  }});
  const response = await createSportsHandlers(client).event(new Request(`http://localhost/api/sports/event?league=nfl&id=${game.id}`));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).event, game);
  assert.deepEqual(requests, ['summary', 'scoreboard']);
});

test('NHL backup updates an exact game, survives a second outage and keeps ESPN authoritative', async () => {
  const raw = structuredClone(fixtures.nhl);
  const game = live.normalizeScoreboard('nhl', raw)[0];
  const at = Date.parse(game.startsAt);
  let clock = at;
  let primaryDown = false;
  let backupDown = false;
  let backupMatches = 0;
  const providerGame = {
    awayTeam: {abbrev: game.away.shortName, score: 2},
    homeTeam: {abbrev: game.home.shortName, score: 3},
    startTimeUTC: game.startsAt, gameScheduleState: 'OK',
    gameState: 'LIVE', clock: {timeRemaining: '02:21'}, periodDescriptor: {number: 3},
  };
  const client = live.createLiveSportsClient({now: () => clock, fetch: async input => {
    const url = new URL(String(input));
    if (url.hostname === 'api-web.nhle.com') {
      assert.match(url.pathname, /^\/v1\/score\/\d{4}-\d{2}-\d{2}$/);
      backupMatches++;
      return backupDown ? new Response(null, {status: 503}) :
        Response.json({games: [providerGame, {...providerGame, startTimeUTC: new Date(at + 3_600_000).toISOString()}]});
    }
    if (!url.pathname.includes('/hockey/nhl/')) return Response.json({events: []});
    return primaryDown ? new Response(null, {status: 503}) : Response.json(raw);
  }});
  raw.events[0].competitions[0].status.type = {name: 'STATUS_IN_PROGRESS', state: 'in', completed: false};
  const offPrimary = await client.getLiveBoard();
  assert.equal(offPrimary.events.find(event => event.id === game.id)?.scoreSource, undefined);
  primaryDown = true;
  clock += 2_000;
  const backup = await client.getLiveBoard();
  const status = backup.leagues.find(league => league.id === 'nhl');
  assert.equal(status?.status, 'stale');
  assert.equal(status?.lastSuccessAt, new Date(at).toISOString());
  assert.equal(status?.scoresUpdatedAt, new Date(clock).toISOString());
  const display = backup.events.find(event => event.id === game.id);
  assert.equal(display?.clock, '02:21');
  assert.equal(display?.home.score, 3);
  assert.equal(display?.scoreSource, 'NHL');
  assert.equal(display?.completed, false);
  assert.equal((await client.getScoreboardEvent('nhl', game.id))?.event.scoreSource, 'NHL');
  await assert.rejects(client.getLiveEvent('nhl', game.id), /503/);
  backupDown = true;
  clock += 2_000;
  const retained = await client.getLiveBoard();
  assert.equal(retained.leagues.find(league => league.id === 'nhl')?.scoresUpdatedAt, status?.scoresUpdatedAt);
  assert.equal(retained.events.find(event => event.id === game.id)?.home.score, 3);
  assert.equal(backupMatches, 2);
  primaryDown = false;
  clock += 5_000;
  const restored = await client.getLiveBoard();
  assert.equal(restored.leagues.find(league => league.id === 'nhl')?.status, 'ok');
  assert.equal(restored.events.find(event => event.id === game.id)?.scoreSource, undefined);
});

test('MLB backup uses both teams and kickoff to disambiguate doubleheaders', async () => {
  const fixture = structuredClone(fixtures.mlb);
  const raw = fixture.events[0].competitions[0];
  raw.status.type = {name:'STATUS_IN_PROGRESS',state:'in',completed:false};
  const [game] = live.normalizeScoreboard('mlb',fixture);
  let clock = Date.parse(game.startsAt);
  let down = false;
  const providerGame = {
    gameDate:game.startsAt,status:{abstractGameState:'Live',detailedState:'In Progress'},
    teams:{away:{team:{abbreviation:game.away.shortName},score:3},home:{team:{abbreviation:game.home.shortName},score:5}},
    linescore:{currentInning:6,inningState:'Bottom'},
  };
  const client = live.createLiveSportsClient({now:()=>clock,fetch:async input=>{
    const url = String(input);
    if (url.startsWith('https://statsapi.mlb.com/')) return Response.json({dates:[{games:[
      {...providerGame,gameDate:new Date(clock+3600_000).toISOString()},
      providerGame,
    ]}]});
    if (url.includes('/baseball/mlb/')) return down ? new Response(null,{status:503}) : Response.json(fixture);
    return Response.json({events:[]});
  }});
  await client.getLiveBoard();
  clock += 2_000;
  down = true;
  const result = await client.getLiveBoard();
  const updated = result.events.find(event=>event.id===game.id);
  assert.equal(updated?.scoreSource,'MLB');
  assert.equal(updated?.home.score,5);
  assert.equal(updated?.statusText,'Bottom 6');
  assert.equal(result.leagues.find(league=>league.id==='mlb')?.backupSource,'MLB');
});

test('a failed team scoreboard can recover a matching active game from ESPN summary', async () => {
  const fixture = structuredClone(fixtures.nfl);
  const game = live.normalizeScoreboard('nfl',fixture).find(event=>event.status==='live');
  assert.ok(game);
  let clock=Date.parse(game.startsAt);
  let down=false;
  const header=structuredClone(fixture.events.find((item:{id:string})=>item.id===game.id));
  assert.ok(header);
  header.competitions[0].competitors.find((side:{homeAway:string})=>side.homeAway==='home').score='24';
  const client=live.createLiveSportsClient({now:()=>clock,fetch:async input=>{
    const url = String(input);
    if (url.endsWith('summary?event='+game.id))return Response.json({header});
    if (url.includes('/football/nfl/'))return down ? new Response(null,{status:503}) : Response.json(fixture);
    return Response.json({events:[]});
  }});
  await client.getLiveBoard();
  down=true;
  clock+=2_000;
  const result=await client.getLiveBoard();
  assert.equal(result.events.find(event=>event.id===game.id)?.scoreSource,'ESPN summary');
  assert.equal(result.events.find(event=>event.id===game.id)?.home.score,24);
  assert.equal(result.leagues.find(league=>league.id==='nfl')?.status,'stale');
  assert.equal((await client.getLiveEvent('nfl',game.id))?.scoreSource,undefined);
});
