import { test, expect } from '@playwright/test';

test('a multi-game submission renders as one grouped free-picks entry with leg controls', async ({page}) => {
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const games = [
    {id:'401201',league:'nba',leagueName:'NBA',sport:'basketball',name:'Boston Celtics at New York Knicks',startsAt,status:'scheduled',statusText:'Tomorrow',clock:null,period:null,winner:null,completed:false,away:{id:'bos',name:'Boston Celtics',shortName:'BOS',score:null},home:{id:'ny',name:'New York Knicks',shortName:'NYK',score:null}},
    {id:'401202',league:'nba',leagueName:'NBA',sport:'basketball',name:'Chicago Bulls at Miami Heat',startsAt,status:'scheduled',statusText:'Tomorrow',clock:null,period:null,winner:null,completed:false,away:{id:'chi',name:'Chicago Bulls',shortName:'CHI',score:null},home:{id:'mia',name:'Miami Heat',shortName:'MIA',score:null}},
  ];
  let tickets: Record<string, unknown>[] = [];
  await page.route('**/api/account', route => route.fulfill({json:{user:{id:'entry-user',username:'entryrider'}}}));
  await page.route('**/api/sports', route => route.fulfill({json:{events:games,leagues:[{id:'nba',name:'NBA',sport:'basketball',status:'ok'}],fetchedAt:new Date().toISOString(),source:'ESPN',refreshAfterMs:15000,stale:false}}));
  await page.route('**/api/picks/**', async route => {
    if (route.request().method() === 'POST' && route.request().url().endsWith('/api/picks/batch')) {
      const entryId = '11111111-1111-4111-8111-111111111111';
      tickets = games.map((game,index) => ({id:`entry-ticket-${index}`,eventId:game.id,league:game.league,eventName:game.name,selection:game.away.name,side:'away',startsAt,createdAt:new Date().toISOString(),status:'open',settledAt:null,entryId,entryIndex:index,entrySize:2}));
      return route.fulfill({json:{tickets}});
    }
    return route.fulfill({json:{tickets}});
  });
  await page.route('**/api/picks', route => route.fulfill({json:{tickets}}));
  await page.goto('/');
  await page.getByRole('button',{name:'Pick Boston Celtics'}).click();
  await page.getByRole('button',{name:'Pick Chicago Bulls'}).click();
  await page.getByRole('button',{name:'Review 2 free picks',exact:true}).click();
  await page.getByRole('button',{name:'Confirm 2 free picks',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Review your free picks'})).toHaveCount(0);
  await page.getByRole('button',{name:'My picks',exact:true}).click();
  await expect(page.getByText('Free-picks entry · 2 legs',{exact:true})).toBeVisible();
  await expect(page.getByText('Leg 1 of 2',{exact:true})).toBeVisible();
  await expect(page.getByText('Leg 2 of 2',{exact:true})).toBeVisible();
  await expect(page.locator('.cw-entry-card')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Cancel pick: Boston Celtics',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Cancel pick: Chicago Bulls',exact:true})).toBeVisible();
});
test('history cancellation requires confirmation and preserves the pick when the server refuses', async ({ page }) => {
  const ticket={id:'manage-ticket',eventId:'401-manage',league:'nba',eventName:'Boston Celtics at New York Knicks',selection:'Boston Celtics',side:'away',startsAt:new Date(Date.now()+86400000).toISOString(),createdAt:new Date().toISOString(),status:'open',settledAt:null};
  let current={...ticket}, attempts=0;
  await page.route('**/api/account', r=>r.fulfill({json:{user:{id:'manage-user',username:'courtside'}}}));
  await page.route('**/api/sports', r=>r.fulfill({json:{events:[],leagues:[],fetchedAt:new Date().toISOString(),source:'ESPN',refreshAfterMs:15000,stale:false}}));
  await page.route('**/api/picks{,?*}', async r=>{
    if(r.request().method()==='DELETE') {
      expect(new URL(r.request().url()).searchParams.get('id')).toBe(ticket.id); attempts++;
      if(attempts===1)return r.fulfill({status:409,json:{message:'Source unavailable. Your pick is unchanged.'}});
      current={...current,status:'cancelled'};
      return r.fulfill({json:{ticket:current}});
    }
    return r.fulfill({json:{tickets:[current]}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'My picks',exact:true}).click();
  await expect(page.getByText(ticket.eventName,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cancel pick: Boston Celtics',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Cancel your free pick?'});
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button',{name:'Keep pick',exact:true}).click();
  expect(attempts).toBe(0);
  await page.getByRole('button',{name:'Cancel pick: Boston Celtics',exact:true}).click();
  await confirmation.getByRole('button',{name:'Confirm cancellation',exact:true}).click();
  await expect(confirmation.getByRole('alert')).toHaveText('Source unavailable. Your pick is unchanged.');
  await expect(page.getByText('Open',{exact:true})).toBeVisible();
  await confirmation.getByRole('button',{name:'Confirm cancellation',exact:true}).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText('Cancelled',{exact:true})).toBeVisible();
  expect(attempts).toBe(2);
  await expect(page.getByRole('button',{name:'Cancel pick: Boston Celtics',exact:true})).toHaveCount(0);
  await page.reload();
  await page.getByRole('button',{name:'My picks',exact:true}).click();
  await expect(page.getByText('Cancelled',{exact:true})).toBeVisible();
});

test('a changed pick stays in My picks and shows its previous selection', async ({page}) => {
  const startsAt = new Date(Date.now()+86400000).toISOString();
  const game = {
    id:'401001',league:'nba',leagueName:'NBA',sport:'basketball',name:'Boston Celtics at New York Knicks',
    startsAt,status:'scheduled',statusText:'Tomorrow',clock:null,period:null,winner:null,completed:false,
    away:{id:'bos',name:'Boston Celtics',shortName:'BOS',score:null},
    home:{id:'ny',name:'New York Knicks',shortName:'NYK',score:null},
  };
  const ticket = {
    id:'edit-ticket',eventId:game.id,league:game.league,eventName:game.name,selection:game.away.name,side:'away',
    startsAt,createdAt:new Date().toISOString(),status:'open',settledAt:null,
  };
  let current = {...ticket};
  await page.route('**/api/account', route=>route.fulfill({json:{user:{id:'edit-user',username:'tester'}}}));
  await page.route('**/api/sports', route=>route.fulfill({json:{
    events:[game],leagues:[{id:'nba',name:'NBA',sport:'basketball',status:'ok'}],
    fetchedAt:new Date().toISOString(),source:'ESPN',refreshAfterMs:15000,stale:false,
  }}));
  await page.route('**/api/picks', route=>{
    if(route.request().method()==='PATCH'){
      expect(route.request().postDataJSON()).toEqual({id:ticket.id, side:'home', revision:0});
      current = {...current,selection:game.home.name,side:'home'};
      Object.assign(current,{changes:[{side:ticket.side,selection:ticket.selection,changedAt:new Date().toISOString()}]});
      return route.fulfill({json:{ticket:current}});
    }
    return route.fulfill({json:{tickets:[current]}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'My picks',exact:true}).click();
  await page.getByRole('button',{name:'Edit pick',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Edit free pick'});
  await expect(dialog.getByRole('button',{name:'Save change'})).toBeDisabled();
  await dialog.getByRole('button',{name:game.home.name}).click();
  await dialog.getByRole('button',{name:'Save change'}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Your pick: New York Knicks')).toBeVisible();
  await page.getByText('Change history (1)',{exact:true}).click();
  await expect(page.getByText('Previously Boston Celtics',{exact:false})).toBeVisible();
});

test('editing a total pick keeps over/under outcomes and the source line', async ({page}) => {
  const startsAt=new Date(Date.now()+86400000).toISOString();
  const game={
    id:'401-total-edit',league:'nba',leagueName:'NBA',sport:'basketball',name:'Boston Celtics at New York Knicks',
    startsAt,status:'scheduled',statusText:'Tomorrow',clock:null,period:null,winner:null,completed:false,
    away:{id:'bos',name:'Boston Celtics',shortName:'BOS',score:null},
    home:{id:'ny',name:'New York Knicks',shortName:'NYK',score:null},
  };
  let ticket={id:'total-edit-ticket',eventId:game.id,league:game.league,eventName:game.name,selection:'Over 210.5',
    side:'over',market:'total',line:210.5,startsAt,createdAt:new Date().toISOString(),status:'open',settledAt:null};
  await page.route('**/api/account',route=>route.fulfill({json:{user:{id:'total-edit-user',username:'totals'}}}));
  await page.route('**/api/sports',route=>route.fulfill({json:{events:[game],leagues:[{id:'nba',name:'NBA',sport:'basketball',status:'ok'}],
    fetchedAt:new Date().toISOString(),source:'ESPN',refreshAfterMs:15000,stale:false}}));
  await page.route('**/api/picks',route=>{
    if(route.request().method()==='PATCH'){
      expect(route.request().postDataJSON()).toEqual({id:ticket.id,side:'under',revision:0});
      ticket={...ticket,side:'under',selection:'Under 210.5'};
      return route.fulfill({json:{ticket}});
    }
    return route.fulfill({json:{tickets:[ticket]}});
  });
  await page.goto('/picks');
  await page.getByRole('button',{name:'Edit pick',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit free pick'});
  await expect(dialog.getByRole('button',{name:'Under 210.5'})).toBeVisible();
  await dialog.getByRole('button',{name:'Under 210.5'}).click();
  await dialog.getByRole('button',{name:'Save change'}).click();
  await expect(page.getByText('Your pick: Under 210.5')).toBeVisible();
});

test('account deletion only sends a request after password confirmation', async ({page}) => {
  const user={id:'deletion-user',username:'courtside'};
  let signedIn=true;
  let requests=0;
  await page.route('**/api/account',route=>route.fulfill({json:{user:signedIn?user:null}}));
  await page.route('**/api/account/follows',route=>route.fulfill({json:{follows:[]}}));
  await page.route('**/api/picks',route=>route.fulfill({json:{tickets:[]}}));
  await page.route('**/api/sports',route=>route.fulfill({json:{
    events:[],leagues:[],fetchedAt:new Date().toISOString(),source:'ESPN',refreshAfterMs:15000,stale:false,
  }}));
  await page.route('**/api/account/delete',route=>{
    requests++;
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().postDataJSON()).toEqual({password:'test-password-only'});
    signedIn=false;
    return route.fulfill({json:{user:null}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Account: courtside'}).click();
  await page.getByRole('button',{name:'Delete account',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Delete account',exact:true});
  await confirmation.getByRole('button',{name:'Keep account'}).click();
  expect(requests).toBe(0);
  await page.getByRole('button',{name:'Delete account',exact:true}).click();
  await confirmation.getByLabel('Current password').fill('test-password-only');
  await confirmation.getByRole('button',{name:'Permanently delete account'}).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  expect(requests).toBe(1);
});

test('pick again restores an eligible settled or cancelled pick into draft selections', async ({ page }) => {
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const game = {
    id: '401099', league: 'nba', leagueName: 'NBA', sport: 'basketball', name: 'Boston Celtics at New York Knicks',
    startsAt, status: 'scheduled', statusText: 'Tomorrow', clock: null, period: null, winner: null, completed: false,
    away: { id: 'bos', name: 'Boston Celtics', shortName: 'BOS', score: null },
    home: { id: 'ny', name: 'New York Knicks', shortName: 'NYK', score: null },
  };
  const ticket = {
    id: 'rebet-ticket', eventId: game.id, league: game.league, eventName: game.name, selection: game.away.name, side: 'away',
    startsAt, createdAt: new Date().toISOString(), status: 'cancelled', settledAt: null,
  };
  await page.route('**/api/account', route => route.fulfill({ json: { user: { id: 'rebet-user', username: 'rebetter' } } }));
  await page.route('**/api/sports', route => route.fulfill({
    json: { events: [game], leagues: [{ id: 'nba', name: 'NBA', sport: 'basketball', status: 'ok' }], fetchedAt: new Date().toISOString(), source: 'ESPN', refreshAfterMs: 15000, stale: false },
  }));
  await page.route('**/api/picks', route => route.fulfill({ json: { tickets: [ticket] } }));

  await page.goto('/picks');
  await expect(page.getByText(ticket.eventName)).toBeVisible();
  const rebetButton = page.getByRole('button', { name: 'Pick again' });
  await expect(rebetButton).toBeVisible();
  await rebetButton.click();

  await expect(page.getByText('Pick restored to your draft')).toBeVisible();
  await expect(page.locator('.cw-picks-rail .cw-selected')).toContainText(game.name);
  await expect(page.locator('.cw-picks-rail .cw-selected')).toContainText(game.away.name);
});

test('daily participation limit restricts free pick draft entry and notifies in toast', async ({ page }) => {
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const game = {
    id: '401088', league: 'nba', leagueName: 'NBA', sport: 'basketball', name: 'Boston Celtics at New York Knicks',
    startsAt, status: 'scheduled', statusText: 'Tomorrow', clock: null, period: null, winner: null, completed: false,
    away: { id: 'bos', name: 'Boston Celtics', shortName: 'BOS', score: null },
    home: { id: 'ny', name: 'New York Knicks', shortName: 'NYK', score: null },
  };
  await page.route('**/api/account', route => route.fulfill({ json: { user: { id: 'limit-user', username: 'limiter' } } }));
  await page.route('**/api/sports', route => route.fulfill({
    json: { events: [game], leagues: [{ id: 'nba', name: 'NBA', sport: 'basketball', status: 'ok' }], fetchedAt: new Date().toISOString(), source: 'ESPN', refreshAfterMs: 15000, stale: false },
  }));
  await page.route('**/api/picks', route => route.fulfill({ json: { tickets: [] } }));

  await page.addInitScript(() => {
    localStorage.setItem('cowboy.responsible-play.v1', JSON.stringify({ dailyPicks: 0, pausedUntil: '', excluded: false }));
  });

  await page.goto('/');
  const pickBtn = page.getByRole('button', { name: 'Pick Boston Celtics' });
  await expect(pickBtn).toBeDisabled();
  await expect(pickBtn).toContainText('Limit');

  await page.getByRole('button', { name: 'Preferences' }).first().click();
  await page.getByLabel('Daily pick reminder limit').selectOption('5');
  await expect(page.getByRole('status')).toContainText('Responsible-play settings saved');

  await page.getByRole('button', { name: 'Sports' }).first().click();
  await expect(page.getByRole('button', { name: 'Pick Boston Celtics' })).toBeEnabled();
  await page.evaluate(() => localStorage.removeItem('cowboy.responsible-play.v1'));
});

test('self-exclusion pauses free picks on this browser and disables pick entry', async ({ page }) => {
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const game = {
    id: '401077', league: 'nba', leagueName: 'NBA', sport: 'basketball', name: 'Boston Celtics at New York Knicks',
    startsAt, status: 'scheduled', statusText: 'Tomorrow', clock: null, period: null, winner: null, completed: false,
    away: { id: 'bos', name: 'Boston Celtics', shortName: 'BOS', score: null },
    home: { id: 'ny', name: 'New York Knicks', shortName: 'NYK', score: null },
  };
  await page.route('**/api/account', route => route.fulfill({ json: { user: { id: 'excl-user', username: 'excluder' } } }));
  await page.route('**/api/sports', route => route.fulfill({
    json: { events: [game], leagues: [{ id: 'nba', name: 'NBA', sport: 'basketball', status: 'ok' }], fetchedAt: new Date().toISOString(), source: 'ESPN', refreshAfterMs: 15000, stale: false },
  }));
  await page.route('**/api/picks', route => route.fulfill({ json: { tickets: [] } }));

  await page.goto('/preferences');
  const checkbox = page.getByLabel('Self-exclude from free picks on this browser');
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(page.getByRole('status')).toContainText('Responsible-play settings saved');

  await page.getByRole('button', { name: 'Sports' }).first().click();
  const pickBtn = page.getByRole('button', { name: 'Pick Boston Celtics' });
  await expect(pickBtn).toBeDisabled();
  await expect(pickBtn).toContainText('Excluded');

  await page.getByRole('button', { name: 'Preferences' }).first().click();
  await page.getByLabel('Self-exclude from free picks on this browser').uncheck();
  await expect(page.getByRole('status')).toContainText('Responsible-play settings saved');

  await page.getByRole('button', { name: 'Sports' }).first().click();
  await expect(page.getByRole('button', { name: 'Pick Boston Celtics' })).toBeEnabled();
  await page.evaluate(() => localStorage.removeItem('cowboy.responsible-play.v1'));
});
