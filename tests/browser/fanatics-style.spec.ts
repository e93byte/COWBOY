import { test, expect } from '@playwright/test';

test('real-feed spotlight opens details and continues to a free selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
  const spotlight = page.getByRole('region', { name: 'In the spotlight' });
  await expect(spotlight).toBeVisible();
  await spotlight.getByRole('button', { name: /Explore/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Game details' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Scores and status provided by ESPN.', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Open original ESPN event/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Watch game' }).click();
  await expect(dialog.getByRole('button', { name: 'Watching' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Game information' }).click();
  await expect(dialog.getByText('Scheduled start')).toBeVisible();
  await dialog.getByRole('button', { name: /^Select / }).first().click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.cw-picks-rail .cw-selected')).toBeVisible();
  await page.getByRole('button', { name: 'Watchlist', exact: true }).first().click();
  await expect(page.locator('.cw-event')).toHaveCount(1);
});

test('league sections collapse, sort and clear combined filters', async ({ page }) => {
  await page.goto('/');
  const group = page.locator('.cw-league-group').first();
  await expect(group).toBeVisible();
  const toggle = group.getByRole('button', { name: /Collapse/ });
  await toggle.click();
  await expect(group.locator('.cw-event')).toHaveCount(0);
  await group.getByRole('button', { name: /Expand/ }).click();
  await expect(group.locator('.cw-event').first()).toBeVisible();
  await page.getByLabel('Sort games').selectOption('start');
  await page.getByRole('searchbox').fill('no-such-team-cowboy');
  await expect(page.getByText('No games in this view')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.locator('.cw-event').first()).toBeVisible();
});

test('long league boards start concise and expand on request', async ({ page }) => {
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const games = Array.from({ length: 7 }, (_, index) => ({
    league: 'nba', sport: 'basketball', leagueName: 'NBA',
    id: `401-test-${index}`,
    name: `Away ${index} at Home ${index}`,
    startsAt, status: 'scheduled', statusText: 'Tomorrow', clock: null, period: null,
    away: { id: `away-${index}`, name: `Away Team ${index}`, shortName: `AWY${index}`, score: null },
    home: { id: `home-${index}`, name: `Home Team ${index}`, shortName: `HOM${index}`, score: null },
    winner: null, completed: false,
  }));
  await page.route('**/api/sports', route => route.fulfill({ json: { events: games, leagues: [{ id: 'nba', sport: 'basketball', name: 'NBA', status: 'ok' }], fetchedAt: new Date().toISOString(), source: 'Fixture', refreshAfterMs: 15000, stale: false } }));
  await page.route('**/api/account', route => route.fulfill({ json: { user: null } }));
  await page.goto('/');
  const group = page.locator('.cw-league-group').first();
  await expect(group.locator('.cw-event')).toHaveCount(5);
  await group.getByRole('button', { name: 'Show all 7 games' }).click();
  await expect(group.locator('.cw-event')).toHaveCount(7);
  await group.getByRole('button', { name: 'Show fewer games' }).click();
  await expect(group.locator('.cw-event')).toHaveCount(5);
});

test('tablet and mobile stay in bounds with persistent sports journeys', async ({ page }) => {
  for (const width of [834, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('.cw-league-group').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await expect(page.getByText('FREE TO PLAY · NO CASH OR PRIZES')).toHaveCount(0);
  }
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'My picks' }).click();
  await expect(page.getByRole('heading', { name: 'My picks', exact: true }).first()).toBeVisible();
  await nav.getByRole('button', { name: 'Sports' }).click();
  await expect(page.getByRole('heading', { name: 'Sports board', exact: true })).toBeVisible();
});

test.describe('schedule dates', () => {
  test.use({timezoneId:'America/Chicago'});

  test('all feed dates use local days and stay consistent with league and status filters', async ({page}) => {
    const game = (id: string, name: string, startsAt: string, status: 'final'|'scheduled', league = 'nba') => ({
      id,name,startsAt,status,league,leagueName:league.toUpperCase(),sport:'basketball',
      statusText:status === 'final' ? 'Final' : 'Scheduled',clock:null,period:null,
      completed:status === 'final',winner:null,
      away:{id:'away-'+id,name:'Away '+id,shortName:'AWY',score:null},
      home:{id:'home-'+id,name:'Home '+id,shortName:'HME',score:null},
    });
    const events = [
      game('401090','Earlier NBA final','2026-11-13T02:00:00Z','final'),
      game('401091','Earlier NBA final two','2026-11-13T04:30:00Z','final'),
      game('401092','Later NBA game','2026-11-25T01:00:00Z','scheduled'),
      game('401093','Another league game','2026-11-13T02:00:00Z','final','wnba'),
    ];
    await page.route('**/api/account', route=>route.fulfill({json:{user:null}}));
    await page.route('**/api/sports', route=>route.fulfill({json:{
      source:'Fixture',fetchedAt:'2026-11-16T12:00:00Z',refreshAfterMs:15000,stale:false,events,
      leagues:[{id:'nba',sport:'basketball',name:'NBA',status:'ok'},{id:'wnba',sport:'basketball',name:'WNBA',status:'ok'}],
    }}));
    await page.route('**/api/sports/event?**', route=>route.fulfill({json:events[0]}));
    await page.setViewportSize({width:390,height:844});
    await page.goto('/');
    const dates=page.getByLabel('Choose a date from the schedule');
    await expect(dates.locator('option[value="2026-11-12"]')).toContainText('3 games');
    await page.getByRole('button',{name:'NBA',exact:true}).click();
    await expect(dates.locator('option[value="2026-11-12"]')).toContainText('2 games');
    await dates.selectOption('2026-11-12');
    await expect(page).toHaveURL(url=>url.searchParams.get('filterLeague')==='nba' && url.searchParams.get('date')==='2026-11-12');
    const scheduleLink=page.url();
    await page.reload();
    await expect(dates).toHaveValue('2026-11-12');
    const earlier=page.getByRole('button',{name:'Details: Earlier NBA final',exact:true});
    await expect(earlier).toBeVisible();
    await earlier.click();
    await expect(page.getByRole('dialog',{name:'Game details'})).toBeVisible();
    await expect(page).toHaveURL(url=>url.searchParams.get('game')==='401090'&&url.searchParams.get('date')==='2026-11-12');
    await page.goBack();
    await expect(page).toHaveURL(scheduleLink);
    await expect(dates).toHaveValue('2026-11-12');
    await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Live',exact:true}).click();
    await expect(page).toHaveURL(/\/live$/);
    await page.goBack();
    await expect(page).toHaveURL(scheduleLink);
    await expect(dates).toHaveValue('2026-11-12');
    await expect(page.getByRole('button',{name:'Details: Later NBA game',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Next available date'}).click();
    await expect(dates).toHaveValue('2026-11-24');
    await expect(page.getByRole('button',{name:'Details: Later NBA game',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Previous available date'}).click();
    await expect(dates).toHaveValue('2026-11-12');
    await page.getByRole('button',{name:'Live now',exact:true}).click();
    await expect(dates.locator('option[value="2026-11-12"]')).toContainText('0 games');
    await expect(page.getByText('Choose another schedule date or clear the filters.')).toBeVisible();
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    await expect(dates).toHaveValue('all');
    await expect(page).toHaveURL(url=>!url.searchParams.has('date'));
    await page.goto('/?date=2026-02-30&filterLeague=nba');
    await expect(dates).toHaveValue('all');
    await page.goto('/?date=2026-11-12&date=2026-11-24');
    await expect(dates).toHaveValue('all');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  });
});

test('schedule links use the sender timezone without changing the recipient preferences', async ({page,browser}) => {
  const game = {
    league:'nba',sport:'basketball',leagueName:'NBA',id:'40109222',name:'Visiting Team at Home Team',
    startsAt:'2026-11-22T05:30:00Z',status:'scheduled',statusText:'Scheduled',clock:null,period:null,
    away:{id:'11',name:'Visiting Team',shortName:'VIS',score:null},
    home:{id:'22',name:'Home Team',shortName:'HME',score:null},winner:null,completed:false,
  };
  const scheduleBoard = {
    source:'Fixture',fetchedAt:'2026-11-16T18:00:00Z',refreshAfterMs:15000,stale:false,
    events:[game],leagues:[{id:'nba',sport:'basketball',name:'NBA',status:'ok'}],
  };
  await page.route('**/api/account',route=>route.fulfill({json:{user:null}}));
  await page.route('**/api/sports',route=>route.fulfill({json:scheduleBoard}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({json:game}));

  await page.goto('/');
  const zone=page.getByRole('combobox',{name:'Schedule timezone'});
  const dates=page.getByLabel('Choose a date from the schedule');
  await zone.selectOption('America/New_York');
  await dates.selectOption('2026-11-22');
  const opener=page.getByRole('button',{name:`Details: ${game.name}`});
  await expect(opener).toBeVisible();
  await expect(page.locator('.cw-event-time time')).toContainText('12:30 AM');
  await zone.selectOption('America/Los_Angeles');
  await expect(opener).toHaveCount(0);
  await dates.selectOption('2026-11-21');
  await expect(page.locator('.cw-event-time time')).toContainText('9:30 PM');
  const scheduleLink=page.url();
  expect(new URL(scheduleLink).searchParams.get('tz')).toBe('America/Los_Angeles');
  const recipient=await browser.newContext({timezoneId:'Asia/Tokyo',viewport:{width:390,height:844}});
  try {
    await recipient.route('**/api/account',route=>route.fulfill({json:{user:null}}));
    await recipient.route('**/api/sports',route=>route.fulfill({json:scheduleBoard}));
    const phone=await recipient.newPage();
    await phone.goto(scheduleLink);
    const phoneOpener=phone.getByRole('button',{name:'Details: '+game.name});
    await expect(phoneOpener).toBeVisible();
    await expect(phone.locator('.cw-event-time time')).toContainText('9:30 PM');
    await expect(phone.getByRole('combobox',{name:'Schedule timezone'})).toHaveValue('America/Los_Angeles');
    expect(await phone.evaluate(()=>localStorage.getItem('cowboy.scheduleZone'))).toBeNull();
    const brokenLink=new URL(scheduleLink);
    brokenLink.searchParams.append('tz','America/New_York');
    await phone.goto(brokenLink.href);
    await expect(phone.getByRole('combobox',{name:'Schedule timezone'})).toHaveValue('local');
    await expect(phoneOpener).toHaveCount(0);
  } finally {
    await recipient.close();
  }
  await opener.click();
  const dialog=page.getByRole('dialog',{name:'Game details'});
  await expect(dialog.locator('.cw-game-status')).toContainText('9:30 PM');
  await page.reload();
  await expect(dialog.locator('.cw-game-status')).toContainText('9:30 PM');
  await page.keyboard.press('Escape');
  await expect(zone).toHaveValue('America/Los_Angeles');
});
