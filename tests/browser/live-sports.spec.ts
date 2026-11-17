import { test, expect, type Page } from '@playwright/test';

import type { LiveBoard, LiveEvent } from '../../app/lib/live-sports';

const future = new Date(Date.now() + 86400000).toISOString();
export const event: LiveEvent = { id: '401-test', league: 'nba', sport: 'basketball', leagueName: 'NBA', name: 'Boston Celtics at New York Knicks', startsAt: future, status: 'scheduled', statusText: 'Tomorrow', clock: null, period: null, home: {id:'ny',name:'New York Knicks',shortName:'NYK',score:null}, away:{id:'bos',name:'Boston Celtics',shortName:'BOS',score:null}, winner:null, completed:false };
export const board: LiveBoard = {events:[event,{...event,id:'402-test',league:'nfl',sport:'football',leagueName:'NFL',name:'Buffalo Bills at Baltimore Ravens',status:'live',statusText:'2nd Quarter',clock:'08:42',period:2,home:{id:'bal',name:'Baltimore Ravens',shortName:'BAL',score:14},away:{id:'buf',name:'Buffalo Bills',shortName:'BUF',score:7}}],leagues:[{id:'nba',sport:'basketball',name:'NBA',status:'ok'},{id:'nfl',sport:'football',name:'NFL',status:'ok'}],fetchedAt:new Date().toISOString(),source:'ESPN',refreshAfterMs:15000,stale:false};
async function setup(page: Page) {
  await page.route('**/api/sports', route => route.fulfill({json:board}));
  await page.route('**/api/account', route => route.fulfill({json:{user:null}}));
}
test('real board shows source, real teams, locks live entry and filters leagues', async ({page}) => {
  await setup(page); await page.goto('/');
  await expect(page.getByRole('heading',{name:'Sports board'})).toBeVisible();
  await expect(page.getByText('ESPN', {exact:true}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Pick Buffalo Bills'})).toBeDisabled();
  await page.getByRole('button',{name:'NBA',exact:true}).click();
  await expect(page.getByText('Baltimore Ravens',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Boston Celtics',{exact:true}).first()).toBeVisible();
  await expect(page.getByText(/wallet|cashout|virtual funds/i)).toHaveCount(0);
});

test('Home sport and league links survive reload and closing Game Center', async ({page}) => {
  const game = {...event,id:'401910001'};
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[game,board.events[1]]}}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:game}));
  await page.goto('/?filterSport=basketball');
  const sports = page.getByRole('navigation',{name:'Sports',exact:true});
  const leagues = page.getByRole('navigation',{name:'Leagues',exact:true});
  await expect(sports.getByRole('button',{name:'Basketball',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(leagues.getByRole('button',{name:'NFL',exact:true})).toHaveCount(0);
  await leagues.getByRole('button',{name:'NBA',exact:true}).click();
  await expect(page).toHaveURL(/filterLeague=nba/);
  await page.reload();
  await expect(leagues.getByRole('button',{name:'NBA',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Open event information for '+game.name,exact:true}).click();
  await expect(page).toHaveURL(/filterLeague=nba.*game=401910001/);
  await page.getByRole('button',{name:'Close Game details'}).click();
  await expect(page).toHaveURL(/\?filterLeague=nba$/);
  await expect(leagues.getByRole('button',{name:'NBA',exact:true})).toHaveAttribute('aria-pressed','true');
  await sports.getByRole('button',{name:'All',exact:true}).click();
  await expect(page).toHaveURL(/\/$/);
});

test('dedicated Live board only shows in-progress games and opens Game Center', async ({page}) => {
  await setup(page);
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:{event:board.events[1]}}));
  await page.goto('/');
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Live board'})).toBeVisible();
  await expect(page.locator('.cw-event')).toHaveCount(1);
  await expect(page.getByRole('button',{name:/^Pick /})).toHaveCount(0);
  const scorecards = page.getByRole('region', {name: 'Live scores'});
  const matchup = scorecards.getByRole('button', {name: 'Explore Buffalo Bills at Baltimore Ravens'});
  await expect(matchup).toContainText('7');
  await expect(matchup).toContainText('14');
  await matchup.click();
  await expect(page.getByRole('dialog',{name:'Game details'})).toContainText('Baltimore Ravens');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'NBA',exact:true}).click();
  await expect(page.getByText('No live games in this view')).toBeVisible();
  await expect(scorecards).toHaveCount(0);
  await page.getByRole('button',{name:'Clear filters'}).click();
  await expect(page.locator('.cw-event')).toHaveCount(1);
});

test('Live, My picks and Game Center URLs survive reload and browser navigation', async ({page}) => {
  const game = {...board.events[1], id: '402102'};
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[event,game]}}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:game}));

  await page.goto('/');
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await expect(page).toHaveURL(/\/live$/);
  await page.getByRole('button',{name:'Game center',exact:true}).click();
  await expect(page).toHaveURL(/\/live\?game=402102&league=nfl$/);
  await page.goBack();
  await expect(page.getByRole('heading',{name:'Live board'})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('dialog',{name:'Game details'})).toContainText(game.home.name);
  await page.reload();
  await expect(page.getByRole('dialog',{name:'Game details'})).toContainText(game.home.name);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/live$/);
  await page.getByRole('button',{name:'My picks',exact:true}).click();
  await expect(page).toHaveURL(/\/picks$/);
  await page.reload();
  await expect(page.getByRole('heading',{name:'My picks'})).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading',{name:'Live board'})).toBeVisible();
});

test('Live links preserve league and finals through reload, Game Center and browser Back', async ({page})=>{
  const final={...board.events[1],id:'401913646',league:'ufc',leagueName:'UFC',sport:'mma',
    status:'final',statusText:'Final',completed:true};
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({json:{
    ...board,events:[board.events[1],final],leagues:[...board.leagues,{id:'ufc',sport:'mma',name:'UFC',status:'ok'}],
  }}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:final}));
  await page.goto('/live?filterLeague=ufc');
  const scope=page.getByRole('button',{name:/Recent finals/});
  const league=page.getByRole('button',{name:'UFC',exact:true});
  await expect(league).toHaveAttribute('aria-pressed','true');
  await scope.click();
  await expect(page).toHaveURL(/\/live\?filterLeague=ufc&scope=final$/);
  await page.reload();
  await expect(league).toHaveAttribute('aria-pressed','true');
  await expect(scope).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Game center',exact:true}).click();
  await expect(page).toHaveURL(/scope=final&game=401913646&league=ufc$/);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/live\?filterLeague=ufc&scope=final$/);
  await page.getByRole('button',{name:'Sports board',exact:true}).click();
  await page.goBack();
  await expect(league).toHaveAttribute('aria-pressed','true');
  await expect(scope).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(page).toHaveURL(/\/live\?scope=final$/);
  await page.goto('/live?filterLeague=bad&scope=unknown');
  await expect(page.getByRole('button',{name:/In progress/})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:/All leagues/})).toHaveAttribute('aria-pressed','true');
});

test('Game Center copies the selected public section and keeps one browser history entry', async ({page}) => {
  const game = {...board.events[1], id: '402102'};
  await setup(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {value: {
      writeText: async () => { throw new Error('Clipboard unavailable'); },
    }});
  });
  await page.route('**/api/sports', route=>route.fulfill({json:{...board,events:[game]}}));
  await page.route('**/api/sports/event?**', route=>route.fulfill({json:game}));
  await page.goto('/live');
  await page.getByRole('button',{name:'Game center',exact:true}).click();
  const modal = page.getByRole('dialog',{name:'Game details'});
  await modal.getByRole('button',{name:'Score',exact:true}).click();
  await modal.getByRole('button',{name:'Timeline',exact:true}).click();
  await expect(page).toHaveURL(/\/live\?game=402102&league=nfl&section=timeline$/);
  await modal.getByRole('button',{name:'Copy game link'}).click();
  const field = modal.getByRole('textbox',{name:'Game link'});
  await expect(field).toHaveValue(/\/\?league=nfl&game=402102&section=timeline$/);
  const shared = await field.inputValue();
  await page.goBack();
  await expect(page).toHaveURL(/\/live$/);
  await expect(modal).toHaveCount(0);
  await page.goto(shared);
  await expect(modal.getByRole('button',{name:'Timeline',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.reload();
  await expect(modal.getByRole('button',{name:'Timeline',exact:true})).toHaveAttribute('aria-pressed','true');
  await modal.getByRole('button',{name:'My pick',exact:true}).click();
  await modal.getByRole('button',{name:'Copy game link'}).click();
  await expect(field).toHaveValue(/\/\?league=nfl&game=402102$/);
  await page.goto(shared+'&section=score');
  await expect(modal.getByRole('button',{name:'Overview',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('Preferences shares schedule and update settings with the board and inbox', async ({page}) => {
  await setup(page);
  await page.goto('/live');
  await page.getByRole('button',{name:'Game updates',exact:true}).click();
  const inbox=page.getByRole('dialog',{name:'Followed game updates'});
  await inbox.getByRole('button',{name:'Preferences',exact:true}).click();
  await expect(page).toHaveURL(/\/preferences$/);
  const prefs=page.getByRole('main');
  await expect(prefs.getByRole('heading',{name:'Preferences',exact:true})).toBeFocused();
  await prefs.getByLabel('Schedule timezone').selectOption('America/Los_Angeles');
  await prefs.getByLabel('Score changes').uncheck();
  await prefs.getByLabel('Enable quiet hours').check();
  await prefs.getByLabel('Quiet start').fill('21:30');
  await page.reload();
  await expect(prefs.getByLabel('Schedule timezone')).toHaveValue('America/Los_Angeles');
  await expect(prefs.getByLabel('Score changes')).not.toBeChecked();
  await expect(prefs.getByLabel('Quiet start')).toHaveValue('21:30');
  await page.goBack();
  await expect(page.getByRole('heading',{name:'Live board'})).toBeVisible();
  await page.getByRole('button',{name:'Game updates',exact:true}).click();
  await expect(inbox.getByLabel('Score changes')).not.toBeChecked();
  await expect(inbox.getByLabel('Quiet start')).toHaveValue('21:30');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Sports board',exact:true}).click();
  await expect(page.getByLabel('Schedule timezone')).toHaveValue('America/Los_Angeles');
});

test('Help links to its sections, searches rules and opens the live pick history', async ({page})=>{
  await setup(page);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('button',{name:'Help & rules',exact:true}).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole('heading',{name:'Help & rules',exact:true})).toBeFocused();
  await expect(page.getByRole('searchbox',{name:'Search help'})).toBeInViewport();
  const topics=page.getByRole('navigation',{name:'Help topics'});
  await topics.getByRole('link',{name:'Results and settlement',exact:true}).click();
  await expect(page).toHaveURL(/\/help#results$/);
  await page.reload();
  await expect(page.locator(':target')).toHaveAttribute('id','results');
  const search=page.getByRole('searchbox',{name:'Search help'});
  await search.fill('confirmed cancellation');
  await expect(page.getByRole('status').filter({hasText:'1 matching article'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'How are results confirmed?'})).toBeVisible();
  await search.fill('xyzunknown');
  await expect(page.getByText('No matching articles')).toBeVisible();
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await expect(search).toBeFocused();
  await expect(topics).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('link',{name:'Open My picks',exact:true}).click();
  await expect(page).toHaveURL(/\/picks$/);
  await expect(page.getByRole('heading',{name:'My picks',exact:true})).toBeVisible();
});

test('Live separates followed games from finals and Game Center renders provider period scores', async ({page}) => {
  const live = board.events[1];
  const final = {
    ...event, status: 'final', statusText: 'Final', completed: true,
    home: {...event.home, score: 102, linescores: [24, 26, 25, 27]},
    away: {...event.away, score: 100, linescores: [0, 30, 30, 40]},
  };
  await setup(page);
  await page.route('**/api/sports', route => route.fulfill({json: {...board, events: [live, final]}}));
  await page.route('**/api/sports/event?**', route => route.fulfill({json: {...final, venue: 'Test arena'}}));
  await page.goto('/');
  await page.getByRole('button', {name: 'Live', exact: true}).click();
  await page.getByRole('button', {name: /^Following/}).click();
  await expect(page.getByText('No followed games are live')).toBeVisible();
  await page.getByRole('button', {name: /^In progress/}).click();
  await page.getByRole('button', {name: `Watch ${live.name}`}).click();
  await page.getByRole('button', {name: /^Following/}).click();
  await expect(page.locator('.cw-event')).toHaveCount(1);
  await page.getByRole('button', {name: /^Recent finals/}).click();
  await expect(page.locator('.cw-event')).toContainText(final.away.name);
  await page.getByRole('button', {name: 'Game center', exact: true}).click();
  const game = page.getByRole('dialog', {name: 'Game details'});
  await expect(game.getByText('Test arena')).toBeVisible();
  await game.getByRole('button', {name: 'Score', exact: true}).click();
  const away = game.getByRole('row').filter({hasText: final.away.shortName});
  await expect(away.getByRole('cell')).toHaveText(['0', '30', '30', '40', '100']);
  await expect(game.getByRole('button', {name: /^Select /})).toHaveCount(0);
});

test('tennis Game Center shows games per set and preserves source tiebreaks without inventing a total', async ({page}) => {
  const tennis:LiveEvent={
    ...board.events[1],
    id:'186783',league:'wta',sport:'tennis',leagueName:'WTA',name:'Tennis player A vs Tennis player B',
    clock:null,period:2,statusText:'2nd Set',
    away:{id:'1',name:'Tennis player A',shortName:'Player A',score:null,linescores:[6,3],
      tennisSetDetails:[{tiebreak:7,winner:false},{tiebreak:null,winner:null}]},
    home:{id:'2',name:'Tennis player B',shortName:'Player B',score:null,linescores:[7,0],
      tennisSetDetails:[{tiebreak:9,winner:true},{tiebreak:null,winner:null}]},
  };
  await page.setViewportSize({width:390,height:844});
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({json:{
    ...board,events:[tennis],leagues:[{id:'wta',sport:'tennis',name:'WTA',status:'ok'}],
  }}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:tennis}));
  await page.goto('/live');
  await page.getByRole('button',{name:'Game center',exact:true}).click();
  const center=page.getByRole('dialog',{name:'Game details'});
  await expect(center.locator('.cw-game-away .cw-set-scores b')).toHaveText(['6','3']);
  await expect(center.locator('.cw-game-home .cw-set-scores b')).toHaveText(['7','0']);
  await center.getByRole('button',{name:'Score',exact:true}).click();
  const scores=center.getByRole('table',{name:'Score by set'});
  await expect(scores.getByRole('columnheader',{name:'Set 2 (in progress)'})).toBeVisible();
  await expect(scores.getByRole('columnheader',{name:'Total',exact:true})).toHaveCount(0);
  const playerB=scores.getByRole('row').filter({hasText:'Player B'});
  await expect(playerB.getByRole('cell',{name:/tiebreak points: 9/})).toBeVisible();
  await expect(playerB.getByRole('cell',{name:'1',exact:true})).toBeVisible();
});

test('soccer Lineups opens from a shared URL and displays a refreshed provider lineup', async ({page})=>{
  const soccer:LiveEvent={...event,id:'401915399',league:'ucl',sport:'soccer',leagueName:'Champions League',
    name:'Barcelona at Paris Saint-Germain',away:{id:'83',name:'Barcelona',shortName:'BAR',score:null},
    home:{id:'160',name:'Paris Saint-Germain',shortName:'PSG',score:null},
    teamStats:[
      {key:'saves',label:'Saves',away:'10',home:'3'},
      {key:'shotsOnTarget',label:'ON GOAL',away:null,home:'14'},
      {key:'possessionPct',label:'Possession',away:'52.9',home:'47.1'},
      {key:'totalShots',label:'SHOTS',away:'18',home:'22'},
    ]};
  const lineup={formation:'4-2-3-1',starters:[{id:'1',name:'Joan García',jersey:'1',position:'Goalkeeper',subbedIn:false}],
    bench:[{id:'2',name:'Substitute Player',jersey:'24',position:'Forward',subbedIn:true}]};
  const positions = ['Goalkeeper', 'Left Back', 'Center Left Defender', 'Center Right Defender', 'Right Back',
    'Left Midfielder', 'Right Midfielder', 'Attacking Midfielder Left', 'Attacking Midfielder',
    'Attacking Midfielder Right', 'Forward'];
  const complete = {...lineup, starters: positions.map((position, index) => ({
    id: String(index + 10), name: index === 0 ? 'Joan García' : `Starter ${index}`,
    jersey: String(index + 1), position, subbedIn: false,
  }))};
  let ready=false;
  let confirmed=false;
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,stale:true}}));
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:ready?{...soccer,soccerLineups:{away:confirmed?complete:lineup,...(confirmed ? {home:{...complete,formation:'4-3-3'}} : {})}}:soccer}));
  await page.goto('/?game=401915399&league=ucl&section=lineups');
  const game=page.getByRole('dialog',{name:'Game details'});
  await expect(game.getByRole('button',{name:'Lineups',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(game.getByText('ESPN has not published a lineup for this match.')).toBeVisible();
  ready=true;
  await game.getByRole('button',{name:'Refresh lineups'}).click();
  const barcelona=game.getByRole('region',{name:'Barcelona lineup'});
  await expect(barcelona.getByText('4-2-3-1')).toBeVisible();
  await expect(barcelona.getByText('Listed starters (1)')).toBeVisible();
  await expect(barcelona.getByText('Joan García')).toBeVisible();
  await expect(game.getByText('Source data is delayed.',{exact:false})).toHaveCount(0);
  await barcelona.getByText('Substitutes (1) · 1 played').click();
  await expect(barcelona.getByText('Substitute Player')).toBeVisible();
  await expect(game.getByRole('region',{name:'Paris Saint-Germain lineup'})).toContainText('ESPN has not published starters');
  await expect(game.getByRole('button',{name:'Formation view'})).toHaveCount(0);
  confirmed=true;
  await game.getByRole('button',{name:'Refresh lineups'}).click();
  const formation = game.getByRole('button',{name:'Formation view'});
  await formation.click();
  await expect(formation).toHaveAttribute('aria-pressed','true');
  await expect(barcelona.locator('.cw-pitch-row li')).toHaveCount(11);
  expect(await barcelona.locator('.cw-pitch-row').evaluateAll(rows=>rows.map(row=>row.childElementCount)))
    .toEqual([1,3,2,4,1]);
  await expect(game.getByRole('region',{name:'Paris Saint-Germain lineup'}).locator(':scope > .cw-soccer-roster > li')).toHaveCount(11);
  await formation.click();
  await expect(barcelona.getByText('Goalkeeper')).toBeVisible();
  await page.reload();
  await expect(barcelona.getByText('Joan García')).toBeVisible();
  expect(await game.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await game.getByRole('button',{name:'Stats',exact:true}).click();
  const stats=game.getByRole('table',{name:'Team statistics comparison'});
  const labels=stats.getByRole('rowheader');
  expect(await labels.allTextContents()).toEqual(['Possession','Shots','Shots on target','Saves']);
  const possession=stats.getByRole('row').filter({hasText:'Possession'});
  await expect(possession).toContainText('52.9%');
  await expect(possession).toContainText('47.1%');
  await expect(possession.locator('.cw-stat-share')).toHaveAttribute('aria-hidden','true');
  await expect(stats.getByRole('row').filter({hasText:'Shots on target'}).locator('.cw-stat-share')).toHaveCount(0);
});

test('UFC groups exact bouts by fight card and preserves the free winner pick flow', async ({page})=>{
  const fight={cardId:'600061665',cardName:'UFC Fight Night: Procházka vs. Stirling',
    order:0,weightClass:'Light Heavyweight',rounds:5,location:'Doha, Qatar',records:{home:'32-6-1',away:'11-0-0'}};
  const main:LiveEvent={...event,id:'401922277',league:'ufc',leagueName:'UFC',sport:'mma',
    name:'Navajo Stirling vs Jiří Procházka',venue:'ABHA Arena',fight,
    home:{id:'3156612',name:'Jiří Procházka',shortName:'J. Procházka',score:null},
    away:{id:'5216713',name:'Navajo Stirling',shortName:'N. Stirling',score:null}};
  const prelims=Array.from({length:6},(_,i)=>({...main,id:'401922'+(260+i),name:'Prelim '+(i+1),fight:{...fight,order:i+1}}));
  const other={...main,id:'401922299',name:'Separate bout',fight:{...fight,cardId:'600061700',cardName:'Separate UFC card'}};
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[...prelims,main,other],
    leagues:[{id:'ufc',sport:'mma',name:'UFC',status:'ok'}]}}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:main}));
  await page.goto('/');
  await page.getByRole('button',{name:'UFC',exact:true}).click();
  const card=page.getByRole('region',{name:fight.cardName+' bouts'});
  await expect(card.locator('.cw-event')).toHaveCount(7);
  await card.getByRole('button',{name:'Details: '+main.name,exact:true}).click();
  const detail=page.getByRole('dialog',{name:'Game details'});
  await expect(detail.getByRole('navigation',{name:'Bouts on this card'}).getByRole('button',{name:other.name})).toHaveCount(0);
  await expect(detail.getByText('Light Heavyweight · 5 scheduled rounds · Doha, Qatar')).toBeVisible();
  await expect(detail.getByText('32-6-1',{exact:false})).toBeVisible();
  await expect(detail.getByText('ABHA Arena')).toBeVisible();
  await detail.getByRole('button',{name:'Result',exact:true}).click();
  await expect(detail.getByRole('region',{name:'Bout result'})).toContainText('This bout has not started.');
  await detail.getByRole('button',{name:'Overview',exact:true}).click();
  await detail.getByRole('button',{name:'Select Navajo Stirling'}).click();
  await expect(page.getByRole('dialog',{name:'Game details'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Remove selection for '+main.name})).toBeVisible();
});

test('UFC recent finals show confirmed winners and source judging without offering a pick', async ({page})=>{
  const final:LiveEvent={...event,id:'401913646',league:'ufc',leagueName:'UFC',sport:'mma',
    name:'Josh Hokit vs Ciryl Gane',status:'final',statusText:'Final',completed:true,winner:'away',period:5,clock:'5:00',
    away:{id:'1',name:'Josh Hokit',shortName:'J. Hokit',score:null},
    home:{id:'2',name:'Ciryl Gane',shortName:'C. Gane',score:null},
    fight:{cardId:'600061400',cardName:'UFC 334: Gane vs. Hokit',order:12,weightClass:'Heavyweight',rounds:5,
      records:{},scorecards:{away:[48,48,48],home:[47,47,47]}}};
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[final],
    leagues:[{id:'ufc',sport:'mma',name:'UFC',status:'ok'}]}}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:final}));
  await page.goto('/live');
  await page.getByRole('button',{name:/Recent finals/}).click();
  const card=page.getByRole('region',{name:final.fight!.cardName+' bouts'});
  await card.getByRole('button',{name:'Game center',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'Game details'});
  await detail.getByRole('button',{name:'Result',exact:true}).click();
  const result=detail.getByRole('region',{name:'Bout result'});
  await expect(result).toContainText('Josh Hokit won.');
  await expect(result.getByRole('region',{name:'Judges’ scores'})).toContainText('48 · 48 · 48');
  await expect(detail.getByRole('button',{name:/^Select /})).toHaveCount(0);
});

test('feed outages lock affected picks while healthy leagues stay available', async ({page}) => {
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({status:502,json:{error:'UPSTREAM_UNAVAILABLE',message:'ESPN unavailable'}}));
  await page.goto('/');
  await expect(page.locator('.cw-alert[role="alert"]')).toContainText('unavailable');
  await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toHaveCount(0);
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,stale:true,leagues:board.leagues.map(l=>({...l,status:'stale'}))}}));
  await page.getByRole('button',{name:'Try again'}).click();
  await expect(page.getByText('Delayed source data.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toBeDisabled();
  const nflFixture = {...board.events[1],status:'scheduled',statusText:'Scheduled',clock:null,period:null};
  await page.route('**/api/sports',route=>route.fulfill({json:{
    ...board,stale:true,events:[event,nflFixture],
    leagues:[board.leagues[0],{...board.leagues[1],status:'stale'}],
  }}));
  await page.getByRole('button',{name:'Refresh sports'}).click();
  await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Pick Buffalo Bills'})).toBeDisabled();
  await page.getByRole('button',{name:'Pick Boston Celtics'}).click();
  await expect(page.getByRole('button',{name:'Sign in to save pick',exact:true})).toBeEnabled();
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,leagues:[board.leagues[0],{...board.leagues[1],status:'error',error:'Timed out'}]}}));
  await page.getByRole('button',{name:'Refresh sports'}).click();
  await expect(page.getByText('NFL: source unavailable · Timed out')).toBeVisible();
  await page.route(/\/api\/sports\?league=nfl$/, route=>route.fulfill({json:board}));
  await page.getByRole('button',{name:'Retry NFL feed'}).click();
  await expect(page.getByRole('button',{name:'Retry NFL feed'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toBeEnabled();
  await page.route('**/api/sports',route=>route.abort());
  await page.getByRole('button',{name:'Refresh sports'}).click();
  await expect(page.locator('.cw-alert[role="alert"]')).toContainText('Last received games');
  await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toBeDisabled();
});

test('watchlist is reversible and persistent; detail uses source data; search and Escape work',async({page})=>{
  await setup(page);
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:{event}}));
  await page.goto('/');
  await page.getByRole('button',{name:`Watch ${event.name}`,exact:true}).click();
  await page.getByRole('button',{name:'Watchlist',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pick Buffalo Bills'})).toHaveCount(0);
  await page.reload();
  await page.getByRole('button',{name:'Watchlist',exact:true}).click();
  await page.getByRole('button',{name:`Details: ${event.name}`,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Game details'});
  await expect(dialog).toContainText(event.away.name);
  await expect(dialog).toContainText('ESPN');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:`Unwatch ${event.name}`,exact:true}).click();
  await expect(page.getByText('No games in this view')).toBeVisible();
  await page.getByRole('button',{name:'All games',exact:true}).click();
  await page.getByRole('searchbox').fill('nothing-matches');
  await expect(page.getByText('No games in this view')).toBeVisible();
});

test('keyboard team discovery and league follows persist into Watchlist and live Following', async ({page}) => {
  await setup(page);
  await page.goto('/');
  const search=page.getByRole('searchbox');
  await search.fill('BOS');
  await search.press('ArrowDown');
  await expect(page.getByRole('button',{name:'Boston Celtics NBA team'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:/^Boston Celtics/})).toBeVisible();
  await expect(page.locator('.cw-event')).toHaveCount(1);
  await page.getByRole('button',{name:'Follow Boston Celtics'}).click();
  await page.getByRole('navigation',{name:'Sports',exact:true}).getByRole('button',{name:'Football',exact:true}).click();
  await page.getByRole('navigation',{name:'Leagues'}).getByRole('button',{name:'NFL',exact:true}).click();
  await page.getByRole('button',{name:'Follow NFL'}).click();
  await page.reload();
  await page.getByRole('button',{name:'Watchlist',exact:true}).first().click();
  await expect(page.locator('.cw-event')).toHaveCount(2);
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await page.getByRole('button',{name:/^Following/}).click();
  await expect(page.locator('.cw-event')).toHaveCount(1);
  await expect(page.locator('.cw-event')).toContainText('Buffalo Bills');
  await page.getByRole('button',{name:'Sports board',exact:true}).click();
  await page.getByRole('button',{name:'Watchlist',exact:true}).first().click();
  await page.getByRole('button',{name:'Unfollow NFL'}).click();
  await expect(page.locator('.cw-event')).toHaveCount(1);
  await expect(page.locator('.cw-event')).toContainText('Boston Celtics');
});

test('tournament and exact event suggestions preserve search and support Escape', async ({page}) => {
  await setup(page);
  const tennis = {...event, id:'403-test',league:'atp',sport:'tennis',leagueName:'ATP',
    name:'Player One vs Player Two — Montevideo Challenger'};
  const turin = {...tennis, id:'another-403-test', name:'Player Three vs Player Four — ATP Finals Turin'};
  await page.route('**/api/sports',route=>route.fulfill({json:{
    ...board,events:[...board.events,tennis,turin],leagues:[...board.leagues,{id:'atp',sport:'tennis',name:'ATP',status:'ok'}],
  }}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:event}));
  await page.goto('/');
  const montevideo=page.getByRole('region',{name:'Montevideo Challenger games',exact:true});
  const turinFinals=page.getByRole('region',{name:'ATP Finals Turin games',exact:true});
  await expect(montevideo.locator('.cw-event')).toHaveCount(1);
  await expect(turinFinals.locator('.cw-event')).toHaveCount(1);
  await montevideo.getByRole('button',{name:'Collapse Montevideo Challenger'}).click();
  await expect(montevideo.locator('.cw-event')).toHaveCount(0);
  await expect(turinFinals.locator('.cw-event')).toHaveCount(1);
  const search=page.getByRole('searchbox');
  await search.fill('montevideo');
  const suggestions=page.getByRole('list',{name:'Search suggestions'});
  await suggestions.getByRole('button',{name:'Montevideo Challenger ATP event series',exact:true}).click();
  await expect(page.locator('.cw-event')).toHaveCount(1);
  await expect(search).toHaveValue('Montevideo Challenger');
  await search.fill(event.name);
  await search.press('ArrowDown');
  await expect(suggestions.getByRole('button',{name:`${event.name} NBA game`,exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(suggestions).toHaveCount(0);
  await expect(search).toBeFocused();
  await search.fill(event.name + ' ');
  await search.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog',{name:'Game details'})).toContainText('New York Knicks');
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
});

test('main metadata, install manifest and offline screen describe actual free picks only',async({page,request})=>{
  await setup(page);await page.goto('/');
  await expect(page).toHaveTitle('COWBOY — Live Sports & Free Picks');
  expect(await page.locator('meta[name="description"]').getAttribute('content')).not.toMatch(/virtual|fictional|practice/i);
  const manifest=await(await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('COWBOY Live Sports & Free Picks');
  expect(manifest.description).not.toMatch(/virtual|fictional|practice/i);
  await page.goto('/offline.html');
  await expect(page.locator('body')).not.toContainText(/virtual|fictional|practice/i);
  await expect(page.locator('body')).toContainText('No free pick can be submitted offline');
});


test('only upstream score changes highlight; scheduled entry locks at start without waiting for a feed poll',async({page})=>{
  const now=new Date();await page.clock.install({time:now});await page.clock.pauseAt(now);
  await setup(page);
  const soon={...event,startsAt:new Date(now.getTime()+5000).toISOString()};
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[soon,board.events[1]]}}));
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toBeEnabled();
  await page.clock.fastForward(6000);
  await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toBeDisabled();
  const game=page.locator('.cw-event').filter({hasText:'Buffalo Bills'});
  await expect(game.locator('.cw-scores-updated')).toHaveCount(0);
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[soon,{...board.events[1],home:{...board.events[1].home,score:17}}]}}));
  await page.getByRole('button',{name:'Refresh sports'}).click();
  await expect(game.locator('.cw-scores-updated')).toHaveText('17');
  await page.clock.fastForward(1800);
  await expect(game.locator('.cw-scores-updated')).toHaveCount(0);
  await page.getByRole('button',{name:'Refresh sports'}).click();
  await expect(game.locator('.cw-scores-updated')).toHaveCount(0);
});

test('featured filters and game updates use observed sports data', async ({page}) => {
  await setup(page);
  const next = {...event, startsAt:new Date(Date.now()+900_000).toISOString()};
  const live = board.events[1];
  let response = {...board, events:[next,live]};
  await page.route('**/api/sports', route=>route.fulfill({json:response}));
  await page.route('**/api/sports/event?**', route=>route.fulfill({json:{event:response.events[1]}}));
  await page.goto('/');
  const spotlight=page.getByRole('region',{name:'In the spotlight'});
  await spotlight.getByRole('button',{name:'Starting soon',exact:true}).click();
  await expect(spotlight.getByRole('button',{name:`Explore ${next.name}`,exact:true})).toBeVisible();
  await expect(spotlight.getByRole('button',{name:`Explore ${live.name}`,exact:true})).toHaveCount(0);
  await spotlight.getByRole('button',{name:'Live games',exact:true}).click();
  await expect(spotlight.getByRole('button',{name:`Explore ${live.name}`,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Live',exact:true}).click();
  const moments=page.getByRole('region',{name:'Game updates'});
  await expect(moments.getByRole('listitem')).toHaveCount(0);
  const refresh=page.getByRole('button',{name:'Refresh sports'});
  const score={...live,home:{...live.home,score:17}};
  response={...response,events:[next,score],fetchedAt:new Date(Date.parse(board.fetchedAt)+15_000).toISOString()};
  await refresh.click();
  await expect(moments.getByRole('button',{name:/Score updated.*BAL 17/})).toBeVisible();
  await refresh.click();
  await expect(moments.getByRole('listitem')).toHaveCount(1);
  response={...response,stale:true,events:[next,{...score,home:{...score.home,score:20}}],
    fetchedAt:new Date(Date.parse(board.fetchedAt)+30_000).toISOString()};
  await refresh.click();
  await expect(moments.getByRole('listitem')).toHaveCount(1);
  await moments.getByRole('button').click();
  await expect(page.getByRole('dialog',{name:'Game details'})).toContainText('Baltimore Ravens');
});

test('polling follows provider interval, pauses while hidden and never overlaps a request',async({page})=>{
  const now=new Date();await page.clock.install({time:now});await page.clock.pauseAt(now);await setup(page);
  let calls=0,holdNext=false;let release:(()=>void)|undefined;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/sports',async route=>{calls++;if(holdNext)await hold;await route.fulfill({json:{...board,refreshAfterMs:2000}}).catch(()=>{});});
  await page.goto('/');await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toBeEnabled();
  const initial=calls;holdNext=true;await page.clock.fastForward(1900);expect(calls).toBe(initial);
  await page.clock.fastForward(200);await expect.poll(()=>calls).toBe(initial+1);
  await expect(page.getByRole('button',{name:'Refresh sports'})).toBeDisabled();
  await page.clock.fastForward(10000);expect(calls).toBe(initial+1);
  holdNext=false;release!();await expect(page.getByRole('button',{name:'Refresh sports'})).toBeEnabled();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.fastForward(10000);expect(calls).toBe(initial+1);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>calls).toBe(initial+2);
});

test('a matching live board supplies the football spot when the event summary has no drive', async ({page}) => {
  const game={...board.events[1],id:'401925211'};
  const footballPosition={possession:'away',fieldPercent:40,spot:'BUF 40',downAndDistance:'1st & 10'};
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[{...game,footballPosition}]}}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:game}));
  await page.goto('/live?game=401925211&league=nfl');
  const field=page.getByRole('region',{name:'Football field position'});
  await expect(field).toContainText('Buffalo Bills possession');
  await expect(field).toContainText('1st & 10 at BUF 40');
});

test('football drives show active and completed possessions and survive a share link reload', async ({page}) => {
  const game={...board.events[1],id:'401925212'};
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[game]}}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:{...game,footballDrives:[
    {id:'1',side:'home',result:null,scoring:false,plays:1,yards:8,duration:'0:24',from:'BAL 21',to:null,period:2,clock:'08:42'},
    {id:'2',side:'away',result:'Touchdown',scoring:true,plays:6,yards:63,duration:'2:49',from:'BUF 37',to:'BAL 0',period:2,clock:'09:06'},
  ]}}));
  await page.setViewportSize({width:390,height:844});
  await page.goto('/live?game=401925212&league=nfl');
  const dialog=page.getByRole('dialog',{name:'Game details'});
  await dialog.getByRole('button',{name:'Drives',exact:true}).click();
  await expect(page).toHaveURL(/section=drives$/);
  const drives=dialog.getByRole('region',{name:'Football drives'});
  const rows=drives.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Baltimore Ravens');
  await expect(rows.first()).toContainText('In progress');
  await expect(rows.last()).toContainText('6 plays · 63 yds · 2:49');
  await expect(rows.last()).toContainText('Touchdown');
  await page.reload();
  await expect(rows).toHaveCount(2);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('an open Game Center refreshes play-by-play, pauses while hidden and stops at final', async ({page})=>{
  await page.clock.install();
  await setup(page);
  const game={...board.events[1],id:'401925210'};
  await page.route('**/api/sports', route=>route.fulfill({json:{...board,events:[game]}}));
  let eventCalls=0;
  let keepRouting: (()=>void)|undefined;
  await page.route('**/api/sports/event?**', async route=>{
    eventCalls++;
    if (eventCalls===2) {
      await new Promise<void>(resolve=>{keepRouting=resolve;});
      return route.fulfill({json:{event:game,stale:true,fallback:'scoreboard',lastSuccessAt:board.fetchedAt}});
    }
    const final=eventCalls===4;
    return route.fulfill({json:{
      ...game,status:final?'final':'live',statusText:final?'Final':'2nd Quarter',completed:final,
      ...(!final ? {footballPosition:{
        possession:'home',fieldPercent:eventCalls===1 ? 80 : 60,
        spot:eventCalls===1 ? 'BAL 20' : 'BAL 40',downAndDistance:eventCalls===1 ? '1st & 10' : '2nd & 5',
      }} : {}),
      timeline:[{id:'play',description:eventCalls===1?'Opening drive':final?'Final whistle':'Touchdown update',
        awayScore:7,homeScore:14,period:2,clock:'07:36'}],
    }});
  });
  await page.goto('/live');
  await page.getByRole('button',{name:'Game center',exact:true}).click();
  const gameCenter=page.getByRole('dialog',{name:'Game details'});
  await gameCenter.getByRole('button',{name:'Timeline',exact:true}).click();
  await expect(gameCenter.getByText('Opening drive')).toBeVisible();
  const field=gameCenter.getByRole('region',{name:'Football field position'});
  await expect(field).toContainText('1st & 10 at BAL 20');
  await expect(field.locator('.cw-football-pitch')).toHaveCSS('--ball-position','80%');
  await page.clock.fastForward(5_500);
  await expect.poll(()=>eventCalls).toBe(2);
  await page.clock.fastForward(30_000);
  expect(eventCalls).toBe(2);
  keepRouting?.();
  await expect(gameCenter.getByText('Game summary unavailable. Showing the last scoreboard update.')).toBeVisible();
  await expect(field).toHaveCount(0);
  await expect(gameCenter.getByText('Opening drive')).toBeVisible();
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(30_000);
  expect(eventCalls).toBe(2);
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(gameCenter.getByText('Touchdown update')).toBeVisible();
  await expect(field).toContainText('2nd & 5 at BAL 40');
  await expect(gameCenter.getByText('Game summary unavailable. Showing the last scoreboard update.')).toHaveCount(0);
  await page.clock.fastForward(5_500);
  await expect(gameCenter.getByText('Final whistle')).toBeVisible();
  await expect(gameCenter.locator('.cw-game-status')).toContainText('Final');
  await expect(field).toHaveCount(0);
  await page.clock.fastForward(45_000);
  expect(eventCalls).toBe(4);
});

test('mobile drawer, auth failure, selected toggle, pending guard, retry, and toast dismissal',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page);
  let authenticated=false,submits=0;
  await page.route('**/api/account',route=>{if(route.request().method()==='POST')return route.fulfill({status:401,json:{error:'INVALID_CREDENTIALS',message:'Username or password is incorrect.'}});return route.fulfill({json:{user:authenticated?{id:'mobile-user',username:'courtside'}:null}});});
  await page.route('**/api/picks',async route=>{
    if(route.request().method()==='POST'){submits++;await new Promise(r=>setTimeout(r,500));return route.fulfill(submits===1?{status:409,json:{error:'SOURCE_CHANGED',message:'Source could not confirm availability. Try again.'}}:{json:{ticket:{id:'mobile-ticket'}}});}
    return route.fulfill({json:{tickets:[]}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).fill('courtside');await page.getByLabel('Password',{exact:true}).fill('test-only-password');
  await page.getByRole('button',{name:'Sign in to COWBOY'}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Username or password is incorrect.');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  authenticated=true;await page.reload();
  await page.getByRole('button',{name:'Pick Boston Celtics'}).click();
  await page.getByRole('button',{name:'Pick Boston Celtics'}).click();
  await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Pick Boston Celtics'}).click();
  await page.getByRole('button',{name:/Your pick: BOS/}).click();
  await expect(page.getByRole('dialog',{name:'Your selection'})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'Review free pick',exact:true}).click();
  await page.getByRole('button',{name:'Confirm free pick'}).click();
  await expect(page.getByRole('button',{name:'Saving free pick…'})).toBeDisabled();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Source could not confirm availability. Try again.');
  expect(submits).toBe(1);
  await page.getByRole('button',{name:'Confirm free pick'}).click();
  await expect(page.getByRole('status').filter({hasText:'Free pick saved'})).toBeVisible();
  expect(submits).toBe(2);
  await page.getByRole('button',{name:'Dismiss notification'}).click();await expect(page.getByText('Free pick saved.',{exact:false})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('register, review, submit and revisit an authenticated free pick; settle from server', async ({page}) => {
  await setup(page);
  let user: {id:string;username:string}|null=null;
  let tickets: Record<string,unknown>[]=[];
  let submits=0;
  await page.route('**/api/account', async route=>{
    if(route.request().method()==='POST'){expect(route.request().postDataJSON().action).toBe('register');user={id:'u-test',username:'courtside'};}
    if(route.request().method()==='DELETE')user=null;
    await route.fulfill({json:{user}});
  });
  await page.route('**/api/picks', async route=>{
    if(route.request().method()==='POST'){
      const payload=route.request().postDataJSON();
      expect(payload).toMatchObject({eventId:event.id,league:'nba',side:'away'});
      expect(payload.requestId).toBeTruthy();submits++;
      tickets=[{id:'t-test',eventId:event.id,league:'nba',eventName:event.name,selection:event.away.name,side:'away',startsAt:event.startsAt,createdAt:new Date().toISOString(),status:'open',settledAt:null}];
      await route.fulfill({json:{ticket:tickets[0]}});return;
    }
    await route.fulfill({json:{tickets}});
  });
  await page.route('**/api/picks/refresh', async route=>{tickets=tickets.map(t=>({...t,status:'won',settledAt:new Date().toISOString()}));await route.fulfill({json:{tickets}});});
  await page.goto('/');
  await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).fill('courtside');
  await page.getByLabel('Password',{exact:true}).fill('test-only-password');
  await page.getByRole('button',{name:'Create free account',exact:true}).click();
  await expect(page.getByRole('button',{name:'Account: courtside'})).toBeVisible();
  await page.getByRole('button',{name:'Pick Boston Celtics'}).click();
  await expect(page.getByRole('button',{name:'Pick Boston Celtics'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Review free pick',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Review your free pick'})).toBeVisible();
  await page.getByRole('button',{name:'Cancel review'}).click();
  expect(submits).toBe(0);
  await page.getByRole('button',{name:'Review free pick',exact:true}).click();
  await page.getByRole('button',{name:'Confirm free pick'}).click();
  await expect(page.getByRole('status').filter({hasText:'Free pick saved'})).toBeVisible();
  expect(submits).toBe(1);
  await page.getByRole('button',{name:'My picks',exact:true}).click();
  await expect(page.getByText('Open', {exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'My picks',exact:true}).click();
  await expect(page.getByText(event.name,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Refresh results'}).click();
  await expect(page.getByText('Won',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Account: courtside'}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true}).first()).toBeVisible();
});

test('Game Center switches league matchups in place and restores board focus on close', async ({page}) => {
  const first = {...event, id: '401011', status: 'final', statusText: 'Final', completed: true};
  const next = {
    ...event, id: '401012', name: 'Toronto Raptors at Chicago Bulls',
    startsAt: new Date(Date.parse(future) + 3600000).toISOString(),
    away: {id:'tor', name:'Toronto Raptors', shortName:'TOR', score:null},
    home: {id:'chi', name:'Chicago Bulls', shortName:'CHI', score:null},
  };
  await page.setViewportSize({width:390,height:844});
  const requested: string[] = [];
  await page.route('**/api/account', route => route.fulfill({json: {user:null}}));
  await page.route('**/api/sports', route => route.fulfill({json: {...board, events: [first, next, board.events[1]]}}));
  await page.route('**/api/sports/event?**', route => {
    const id = new URL(route.request().url()).searchParams.get('id') ?? '';
    requested.push(id);
    return route.fulfill({json: id === next.id ? next : first});
  });
  await page.goto('/');
  const opener = page.getByRole('button', {name: `Details: ${first.name}`});
  await opener.click();
  const dialog = page.getByRole('dialog', {name:'Game details'});
  const matchups = dialog.getByRole('navigation', {name:'NBA matchups'});
  await expect(matchups.getByRole('button')).toHaveCount(2);
  await expect(matchups.getByRole('button', {name:first.name})).toHaveAttribute('aria-current', 'true');
  await dialog.getByRole('button', {name:'Score',exact:true}).click();
  const nextGame = matchups.getByRole('button', {name:next.name});
  await nextGame.focus();
  await page.keyboard.press('Enter');
  await expect(nextGame).toBeFocused();
  await expect(nextGame).toHaveAttribute('aria-current', 'true');
  await expect(dialog.getByRole('button', {name:'Score',exact:true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/game=401012&league=nba&section=score$/);
  const switcher = dialog.getByRole('group',{name:'Switch matchup'});
  await expect(switcher.getByRole('status')).toHaveText('2 of 2 matchups');
  await expect(switcher.getByRole('button',{name:'Next matchup'})).toHaveAttribute('aria-disabled','true');
  await expect.poll(() => requested).toEqual([first.id,next.id]);
  await switcher.getByRole('button',{name:'Previous matchup'}).click();
  await expect(switcher.getByRole('status')).toHaveText('1 of 2 matchups');
  await expect(page).toHaveURL(/game=401011&league=nba&section=score$/);
  await dialog.getByRole('button',{name:'My pick',exact:true}).click();
  await switcher.getByRole('button',{name:'Next matchup'}).click();
  await expect(dialog.getByRole('button',{name:'Overview',exact:true})).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button',{name:'Select Toronto Raptors'})).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('Game Center follows the address bar, Back, Forward and pasted links', async ({page}) => {
  const first = {...event, id:'401021'};
  const second = {
    ...event, id:'401022', name:'Toronto Raptors at Chicago Bulls',
    startsAt: new Date(Date.parse(future)+3600000).toISOString(),
    away:{id:'tor',name:'Toronto Raptors',shortName:'TOR',score:null},
    home:{id:'chi',name:'Chicago Bulls',shortName:'CHI',score:null},
  };
  await page.route('**/api/account', route=>route.fulfill({json:{user:null}}));
  await page.route('**/api/sports', route=>route.fulfill({json:{...board,events:[first,second]}}));
  await page.route('**/api/sports/event?**', route=>{
    const id=new URL(route.request().url()).searchParams.get('id');
    return route.fulfill({json:id===second.id?second:first});
  });
  await page.goto('/?ref=board');
  const opener=page.getByRole('button',{name:`Details: ${first.name}`});
  await opener.click();
  const dialog=page.getByRole('dialog',{name:'Game details'});
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/ref=board&game=401021&league=nba/);
  await dialog.getByRole('navigation',{name:'NBA matchups'}).getByRole('button',{name:second.name}).click();
  await expect(page).toHaveURL(/ref=board&game=401022&league=nba/);
  await page.goBack();
  await expect(page).toHaveURL(/\/?\?ref=board$/);
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await page.goForward();
  await expect(dialog.locator('.cw-game-scoreboard')).toContainText('Chicago Bulls');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/?\?ref=board$/);
  await page.goto('/?league=nba&game=401022');
  await expect(dialog.locator('.cw-game-scoreboard')).toContainText('Chicago Bulls');
  await dialog.getByRole('button',{name:'Close Game details'}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('an older saved pick keeps its record when a game is unavailable and accepts a matching scoreboard fallback', async ({page}) => {
  await setup(page);
  const game = {...event, id:'401941122', name:'Boston Celtics at New York Knicks', status:'final', completed:true,
    statusText:'Final', startsAt:'2026-10-10T00:00:00.000Z', away:{...event.away,score:114}, home:{...event.home,score:102}};
  const ticket = {id:'finished-pick',eventId:game.id,league:game.league,eventName:game.name,
    selection:game.away.name,side:'away',startsAt:game.startsAt,createdAt:'2026-10-09T00:00:00.000Z',
    status:'won',settledAt:'2026-10-10T04:00:00.000Z'};
  await page.route('**/api/account', route=>route.fulfill({json:{user:{id:'owner',username:'rider'}}}));
  await page.route('**/api/picks', route=>route.fulfill({json:{tickets:[ticket]}}));
  let fallback = false;
  await page.route('**/api/sports/event?**', route=>fallback
    ? route.fulfill({json:{event:game,stale:true,fallback:'scoreboard',lastSuccessAt:board.fetchedAt}})
    : route.fulfill({status:404,json:{error:'Event not found'}}));
  await page.goto('/picks');
  await page.getByRole('button',{name:'Game center',exact:true}).click();
  const unavailable = page.getByRole('dialog',{name:'Game unavailable'});
  await expect(unavailable).toContainText(game.name);
  await expect(unavailable).toContainText('Your pick: Boston Celtics');
  await expect(page).toHaveURL(/\/picks\?game=401941122&league=nba/);
  fallback = true;
  await unavailable.getByRole('button',{name:'Retry matchup'}).click();
  const detail = page.getByRole('dialog',{name:'Game details'});
  await expect(detail).toContainText('Game summary unavailable. Showing the last scoreboard update.');
  await expect(detail).toContainText('114');
  await detail.getByRole('button',{name:'My pick',exact:true}).click();
  await expect(detail.getByRole('region',{name:'Saved free pick'})).toContainText('Correct pick');
  await detail.getByRole('button',{name:'Close Game details'}).click();
  await expect(page).toHaveURL(/\/picks$/);
});

test('multiple drafts support switching, removal and clearing before separate submission', async ({page}) => {
  const second = {
    ...event, id:'401023', name:'Toronto Raptors at Chicago Bulls',
    away:{id:'tor',name:'Toronto Raptors',shortName:'TOR',score:null},
    home:{id:'chi',name:'Chicago Bulls',shortName:'CHI',score:null},
  };
  const boardResponse={...board,events:[event,second]};
  let submitted: {eventId:string;side:string}[] = [];
  await page.route('**/api/account',route=>route.fulfill({json:{user:{id:'batch-user',username:'rider'}}}));
  await page.route('**/api/sports',route=>route.fulfill({json:boardResponse}));
  await page.route('**/api/picks',route=>route.fulfill({json:{tickets:[]}}));
  await page.route('**/api/picks/batch', route=>{
    submitted=route.request().postDataJSON().picks;
    return route.fulfill({json:{tickets:[]}});
  });
  await page.goto('/');
  const firstPick=page.getByRole('button',{name:'Pick Boston Celtics',exact:true});
  const secondPick=page.getByRole('button',{name:'Pick Chicago Bulls',exact:true});
  await firstPick.click();
  await secondPick.click();
  await page.reload();
  await expect(firstPick).toHaveAttribute('aria-pressed','true');
  await expect(secondPick).toHaveAttribute('aria-pressed','true');
  const firstDraft = page.getByRole('group',{name:`Selection for ${event.name}`,exact:true});
  const switchSide = firstDraft.getByRole('button',{name:event.home.name,exact:true});
  await switchSide.click();
  await expect(switchSide).toBeFocused();
  await expect(switchSide).toHaveAttribute('aria-pressed','true');
  await expect(firstPick).toHaveAttribute('aria-pressed','false');
  await expect(secondPick).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Clear draft picks',exact:true}).click();
  await page.getByRole('button',{name:'Keep drafts',exact:true}).click();
  await expect(secondPick).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Clear draft picks',exact:true}).click();
  await page.getByRole('button',{name:'Clear all',exact:true}).click();
  await expect(firstDraft).toHaveCount(0);
  await expect(secondPick).toHaveAttribute('aria-pressed','false');
  await page.reload();
  await expect(secondPick).toHaveAttribute('aria-pressed','false');
  await firstPick.click();
  await secondPick.click();
  await switchSide.click();
  await page.getByRole('button',{name:`Remove selection for ${second.name}`,exact:true}).click();
  await expect(secondPick).toHaveAttribute('aria-pressed','false');
  await secondPick.click();
  await page.getByRole('button',{name:'Review 2 free picks',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Review your free picks'});
  await expect(dialog).toContainText(event.home.name);
  await expect(dialog).toContainText('Chicago Bulls');
  await dialog.getByRole('button',{name:'Confirm 2 free picks',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'2 free picks saved'})).toBeVisible();
  expect(submitted.map(pick=>[pick.eventId,pick.side])).toEqual([[event.id,'home'],[second.id,'home']]);
  await expect(firstPick).toHaveAttribute('aria-pressed','false');
});

test('soccer Draw is selectable on the board and in Game Center and is kept in the draft review', async ({page}) => {
  const match = {...event,id:'402051',name:'Fulham at Manchester City',league:'epl',leagueName:'Premier League',sport:'soccer'};
  await page.route('**/api/account', route=>route.fulfill({json:{user:{id:'draw-user',username:'supporter'}}}));
  await page.route('**/api/picks', route=>route.fulfill({json:{tickets:[]}}));
  await page.route('**/api/sports', route=>route.fulfill({json:{
    ...board, events:[match,event], leagues:[...board.leagues,{id:'epl',name:'Premier League',sport:'soccer',status:'ok'}],
  }}));
  await page.route('**/api/sports/event?**', route=>route.fulfill({json:match}));
  await page.goto('/');
  const draw = page.getByRole('button',{name:'Pick Draw',exact:true});
  await expect(draw).toHaveCount(1);
  await page.getByRole('button',{name:`Details: ${match.name}`}).click();
  await page.getByRole('dialog',{name:'Game details'}).getByRole('button',{name:'Select Draw',exact:true}).click();
  await expect(draw).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Review free pick',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Review your free pick'})).toContainText('Draw');
});

test('followed updates count unread changes, open the game and remember notification types', async ({page}) => {
  const followed={...board.events[1],id:'401741'};
  const other={...board.events[1],id:'401742',name:'Miami at Tampa Bay',
    away:{id:'mia',name:'Miami Dolphins',shortName:'MIA',score:7},
    home:{id:'tb',name:'Tampa Bay Buccaneers',shortName:'TB',score:7}};
  let response={...board,events:[followed,other],refreshAfterMs:60000};
  await page.route('**/api/account',route=>route.fulfill({json:{user:null}}));
  await page.route('**/api/sports',route=>route.fulfill({json:response}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:followed}));
  await page.goto('/');
  await page.getByRole('button',{name:`Watch ${followed.name}`,exact:true}).click();
  const refresh=page.getByRole('button',{name:'Refresh sports'});
  const updateScore=(step:number,first:number,second:number)=>{
    response={...response,fetchedAt:new Date(Date.parse(board.fetchedAt)+step*15000).toISOString(),
      events:[{...followed,home:{...followed.home,score:first}},{...other,home:{...other.home,score:second}}]};
  };
  updateScore(1,17,10);
  await refresh.click();
  await page.getByRole('button',{name:'Game updates, 1 unread',exact:true}).click();
  const inbox=page.getByRole('dialog',{name:'Followed game updates'});
  await expect(inbox.getByRole('listitem')).toHaveCount(1);
  await expect(inbox.getByText(followed.name,{exact:true})).toBeVisible();
  await expect(inbox.getByText(other.name,{exact:true})).toHaveCount(0);
  await inbox.getByRole('button',{name:'Mark all as read'}).click();
  await expect(inbox.getByRole('status')).toHaveText('0 unread');
  await inbox.getByRole('button',{name:/Score updated/}).click();
  await expect(page.getByRole('dialog',{name:'Game details'})).toContainText('Baltimore Ravens');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Game updates',exact:true}).click();
  await inbox.getByRole('checkbox',{name:'Score changes'}).uncheck();
  await expect(inbox.getByRole('listitem')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button',{name:'Game updates',exact:true}).click();
  await expect(inbox.getByRole('checkbox',{name:'Score changes'})).not.toBeChecked();
});

test.describe('pregame reminders', () => {
  test.use({timezoneId:'America/Chicago'});

  test('appear ten minutes before kickoff and respect overnight quiet hours', async ({page}) => {
    const start = new Date('2026-11-17T06:19:00Z');
    await page.clock.install({time:start});
    const game = {...event,id:'401310',startsAt:'2026-11-17T06:30:00Z'};
    await page.route('**/api/account',route=>route.fulfill({json:{user:null}}));
    await page.route('**/api/sports',route=>route.fulfill({json:{
      ...board,events:[game],fetchedAt:start.toISOString(),refreshAfterMs:3600000,
    }}));
    await page.goto('/');
    await page.getByRole('button',{name:`Watch ${game.name}`,exact:true}).click();
    const button=page.getByRole('button',{name:'Game updates',exact:true});
    await button.click();
    const dialog=page.getByRole('dialog',{name:'Followed game updates'});
    await dialog.getByRole('checkbox',{name:'Pregame reminders (10 minutes)'}).check();
    await dialog.getByRole('checkbox',{name:'Enable quiet hours'}).check();
    await expect(dialog.getByText('Quiet hours active. Unread badge paused.')).toBeVisible();
    await expect(dialog.getByText('Starts within 10 minutes')).toHaveCount(0);
    await page.clock.fastForward(61000);
    await expect(dialog.getByText('Starts within 10 minutes')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(button).toBeVisible();
    await button.click();
    await dialog.getByLabel('Quiet end').fill('00:20');
    await expect(dialog.getByText('Quiet hours active. Unread badge paused.')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Game updates, 1 unread'})).toBeVisible();
    await page.reload();
    await page.getByRole('button',{name:'Game updates, 1 unread'}).click();
    await expect(dialog.getByLabel('Quiet end')).toHaveValue('00:20');
    await page.clock.fastForward(600000);
    await expect(dialog.getByText('Starts within 10 minutes')).toHaveCount(0);
  });
});

test('offline reload shows the last ESPN slate and skips account and pick caches', async ({page,context}) => {
  await setup(page);
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Install COWBOY app'})).toBeVisible();
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null && !!localStorage.getItem('cowboy.offlineBoard.v1'));
  const cachedPaths=await page.evaluate(async()=>{
    const workerCache=(await caches.keys()).find(name=>name.startsWith('cowboy-live-shell'));
    return workerCache ? (await (await caches.open(workerCache)).keys()).map(request=>new URL(request.url).pathname) : [];
  });
  expect(cachedPaths).toContain('/offline-board.js');
  expect(cachedPaths.some(path=>path.startsWith('/api/'))).toBe(false);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading',{name:'Last saved scoreboard'})).toBeVisible();
    await expect(page.getByText(/ESPN snapshot saved/)).toBeVisible();
    await expect(page.getByText('Boston Celtics',{exact:true})).toBeVisible();
    await page.getByRole('combobox',{name:'League'}).selectOption('NFL');
    await expect(page.getByText('Boston Celtics',{exact:true})).toHaveCount(0);
    await expect(page.getByText('Baltimore Ravens',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:/^Pick /})).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
  await page.getByRole('link',{name:'Try connecting again'}).click();
  await expect(page.getByRole('heading',{name:'Sports board',exact:true})).toBeVisible();
});

test('Home glance prioritizes a followed matchup and opens the exact Game Center', async ({page}) => {
  const followed={...event,id:'401881042'};
  const live={...board.events[1],id:'401881043'};
  let response={...board,events:[followed,live],refreshAfterMs:60000};
  const requested: string[] = [];
  await page.route('**/api/account',route=>route.fulfill({json:{user:null}}));
  await page.route('**/api/sports',route=>route.fulfill({json:response}));
  await page.route('**/api/sports/event?**',route=>{
    const id = new URL(route.request().url()).searchParams.get('id') ?? '';
    requested.push(id);
    return route.fulfill({json:id === followed.id ? followed : live});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  const glance=page.getByRole('region',{name:'Sports at a glance'});
  await expect(glance.getByRole('button',{name:`Glance game: ${live.name}`})).toBeVisible();
  await page.getByRole('button',{name:`Watch ${followed.name}`,exact:true}).click();
  await expect(glance.getByRole('heading',{name:'Your next game'})).toBeVisible();
  await expect(page.getByRole('region',{name:'In the spotlight'}).getByRole('button',{name:`Explore ${followed.name}`})).toHaveCount(0);
  await glance.getByRole('button',{name:`Glance game: ${followed.name}`}).click();
  await expect(page.getByRole('dialog',{name:'Game details'}).locator('.cw-game-scoreboard')).toContainText('Boston Celtics');
  await expect.poll(()=>requested).toContain(followed.id);
  await page.keyboard.press('Escape');
  response={...response,stale:true};
  await page.getByRole('button',{name:'Refresh sports'}).click();
  await expect(glance.getByText(/Last received/)).toBeVisible();
  await glance.getByRole('button',{name:'Open Watchlist',exact:true}).click();
  await expect(glance).toHaveCount(0);
  await expect(page.getByRole('button',{name:`Details: ${followed.name}`,exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('Players switches from pregame season averages to the live box score', async ({page}) => {
  const pregame:LiveEvent={...event,id:'401910001',pregameLeaders:[
    {key:'assistsPerGame',label:'Assists',away:[{id:'2',name:'Visiting playmaker',value:'6.2'}],home:[]},
    {key:'pointsPerGame',label:'Points',away:[{id:'3',name:'Visiting scorer',value:'24.5'}],home:[]},
  ]};
  const started:LiveEvent={...pregame,status:'live',pregameLeaders:undefined,playerStats:{away:[
    {name:'Box score',columns:['PTS','MIN','FG'],players:[
      {id:'3',name:'Visiting scorer',values:['2','9:42','1-3']},
      {id:'4',name:'High scorer',values:['13','4:05','5-10']},
      {id:'5',name:'Reserve',values:['','12:08','0-0']},
    ]},
  ],home:[]}};
  let live=false;
  await setup(page);
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:live?started:pregame}));
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[pregame]}}));
  await page.goto('/?game='+pregame.id+'&league='+pregame.league+'&section=players');
  const game=page.getByRole('dialog',{name:'Game details'});
  const preview=game.getByRole('region',{name:'Pregame player leaders'});
  await expect(preview.getByText('24.5 points per game')).toBeVisible();
  await preview.getByRole('button',{name:'Assists',exact:true}).click();
  await expect(preview.getByText('6.2 assists per game')).toBeVisible();
  live=true;
  await preview.getByRole('button',{name:'Refresh players'}).click();
  const boxScore=game.getByRole('region',{name:'Player box score'});
  await expect(boxScore.getByRole('rowheader',{name:'Visiting scorer'})).toBeVisible();
  await expect(boxScore.getByRole('cell',{name:'2',exact:true})).toBeVisible();
  await expect(preview).toHaveCount(0);
  const players=boxScore.getByRole('rowheader');
  const sort=boxScore.getByRole('button',{name:'Sort by PTS',exact:true});
  await sort.focus();
  await page.keyboard.press('Enter');
  await expect(players).toHaveText(['High scorer','Visiting scorer','Reserve']);
  await expect(boxScore.getByRole('columnheader',{name:'Sort by PTS',exact:true})).toHaveAttribute('aria-sort','descending');
  await sort.click();
  await expect(players).toHaveText(['Visiting scorer','High scorer','Reserve']);
  await boxScore.getByRole('button',{name:'Sort by MIN',exact:true}).click();
  await expect(players).toHaveText(['Reserve','Visiting scorer','High scorer']);
  await expect(boxScore.getByRole('button',{name:'Sort by FG',exact:true})).toHaveCount(0);
  const search=boxScore.getByRole('searchbox',{name:'Find player'});
  await search.fill('scorer');
  await expect(players).toHaveText(['Visiting scorer','High scorer']);
  await search.fill('missing player');
  await expect(boxScore.getByText('No players match this search.')).toBeVisible();
});

test('Game Center shows matchup leaders and expands the full provider list in place', async ({page}) => {
  const game = {...board.events[1],id:'401773'};
  const leaders = ['Passing Yards','Rushing Yards','Receiving Yards','Tackles'].map((label,index)=>({
    key:'stat-'+index,label,away:[{id:'2',name:'Away athlete',value:'12 YDS'}],home:[{id:'3',name:'Home athlete',value:'16 YDS'}],
  }));
  await page.route('**/api/account',route=>route.fulfill({json:{user:null}}));
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[game]}}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:{...game,leaders}}));
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('button',{name:`Details: ${game.name}`,exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Game details'});
  const section = dialog.getByRole('region',{name:'Game leaders'});
  await expect(section.getByRole('rowheader',{name:'Passing Yards'})).toBeVisible();
  await expect(section.getByRole('rowheader',{name:'Tackles'})).toHaveCount(0);
  await section.getByRole('button',{name:'See all leaders'}).click();
  await expect(section.getByRole('rowheader',{name:'Tackles'})).toBeVisible();
  await dialog.getByRole('button',{name:'Stats',exact:true}).click();
  await expect(section.getByRole('rowheader',{name:'Tackles'})).toBeVisible();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
});

test('Game Center scrubs real score snapshots in recorded order', async ({page}) => {
  const game={...board.events[1],id:'401126666'};
  const timeline=[
    {id:'3',awayScore:7,homeScore:14,description:'Ravens touchdown',period:2,clock:'08:42',side:'home'},
    {id:'2',awayScore:7,homeScore:7,description:'Bills tied the game',period:1,clock:'03:15',side:'away'},
    {id:'1',awayScore:0,homeScore:7,description:'Opening score',period:1,clock:'10:05',side:'home'},
  ];
  await page.route('**/api/account',route=>route.fulfill({json:{user:null}}));
  await page.route('**/api/sports',route=>route.fulfill({json:{...board,events:[game]}}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:{...game,timeline}}));
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('button',{name:`Details: ${game.name}`,exact:true}).click();
  await page.getByRole('dialog',{name:'Game details'}).getByRole('button',{name:'Score',exact:true}).click();
  const section=page.getByRole('region',{name:'Score progression'});
  const slider=section.getByRole('slider',{name:'Recorded score updates'});
  await expect(slider).toHaveAttribute('aria-valuetext','Update 3 of 3: BUF 7, BAL 14');
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuetext','Update 2 of 3: BUF 7, BAL 7');
  await expect(section.getByText('Bills tied the game')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext','Update 1 of 3: BUF 0, BAL 7');
  await expect(section.getByText('Opening score')).toBeVisible();
});

test('Live counts and updates follow each sport and league selection', async ({page}) => {
  const football = board.events[1];
  const soccer: LiveEvent = {
    ...football, id: '401912300', sport: 'soccer', league: 'epl', leagueName: 'Premier League',
    name: 'Arsenal at Everton',
    home: {id:'eve', name:'Everton', shortName:'EVE', score:0},
    away: {id:'ars', name:'Arsenal', shortName:'ARS', score:1},
  };
  const otherSoccer: LiveEvent = {
    ...soccer, id:'401912302', league:'mls', leagueName:'MLS', name:'Toronto FC at Chicago Fire',
    home:{id:'chi',name:'Chicago Fire',shortName:'CHI',score:0},
    away:{id:'tor',name:'Toronto FC',shortName:'TOR',score:1},
  };
  const finalFootball: LiveEvent = {
    ...football, id:'401912301', status:'final', statusText:'Final', completed:true,
  };
  let response: LiveBoard = {
    ...board, events:[football,soccer,otherSoccer,finalFootball],
    leagues:[...board.leagues,{id:'epl',sport:'soccer',name:'Premier League',status:'ok'},
      {id:'mls',sport:'soccer',name:'MLS',status:'ok'}],
  };
  await setup(page);
  await page.route('**/api/sports',route=>route.fulfill({json:response}));
  await page.setViewportSize({width:390,height:844});
  await page.goto('/live');
  const views = page.getByRole('group',{name:'Live board views'});
  await expect(views.getByRole('button',{name:'In progress 3'})).toBeVisible();
  response = {
    ...response, fetchedAt:new Date(Date.parse(response.fetchedAt)+15_000).toISOString(),
    events:[{...football, home:{...football.home,score:17}}, {...soccer, away:{...soccer.away,score:2}}, otherSoccer, finalFootball],
  };
  await page.getByRole('button',{name:'Refresh sports'}).click();
  const updates = page.getByRole('region',{name:'Game updates'});
  await expect(updates.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('navigation',{name:'Sports',exact:true}).getByRole('button',{name:'Soccer'}).click();
  await expect(views.getByRole('button',{name:'In progress 2'})).toBeVisible();
  await expect(views.getByRole('button',{name:'Recent finals 0'})).toBeVisible();
  await expect(updates.getByRole('button')).toHaveText(/ARS 2/);
  const leagues=page.getByRole('navigation',{name:'Leagues',exact:true});
  await leagues.getByRole('button',{name:'Premier League',exact:true}).click();
  await expect(page).toHaveURL(/filterLeague=epl/);
  await expect(leagues.getByRole('button',{name:'MLS',exact:true})).toBeVisible();
  await expect(leagues.getByRole('button',{name:'NFL',exact:true})).toHaveCount(0);
  await expect(views.getByRole('button',{name:'In progress 1'})).toBeVisible();
  await expect(updates.getByRole('listitem')).toHaveCount(1);
  await views.getByRole('button',{name:'Following 0'}).click();
  await expect(updates.getByRole('listitem')).toHaveCount(0);
  await leagues.getByRole('button',{name:'All Soccer',exact:true}).click();
  await expect(page).toHaveURL(url=>url.searchParams.get('filterSport')==='soccer' &&
    url.searchParams.get('scope')==='following' && !url.searchParams.has('filterLeague'));
  await page.reload();
  await expect(leagues.getByRole('button',{name:'All Soccer',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(leagues.getByRole('button',{name:'MLS',exact:true})).toBeVisible();
});
