import { test, expect } from '@playwright/test';

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
