

import { test, expect } from '@playwright/test';

test('recent results and the current run use game order and respect record filters', async ({page}) => {
  const base={league:'nba',selection:'Boston Celtics',side:'away',createdAt:'2026-11-09T00:00:00Z',settledAt:'2026-11-16T00:00:00Z'};
  const tickets=[
    {...base,id:'newer',eventId:'401000004',eventName:'Latest Boston game',startsAt:'2026-11-14T00:00:00Z',status:'won'},
    {...base,id:'void',eventId:'401000005',eventName:'Voided Chicago game',startsAt:'2026-11-15T00:00:00Z',status:'void'},
    {...base,id:'middle',eventId:'401000003',eventName:'Earlier Toronto game',startsAt:'2026-11-13T00:00:00Z',status:'won'},
    {...base,id:'oldest',eventId:'401000001',eventName:'Older New York game',startsAt:'2026-11-11T00:00:00Z',status:'lost'},
    {...base,id:'open',eventId:'401000006',eventName:'Open Miami game',startsAt:'2026-11-20T00:00:00Z',status:'open',settledAt:null},
  ].reverse();
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/account',route=>route.fulfill({json:{user:{id:'form-user',username:'courtside'}}}));
  await page.route('**/api/sports',route=>route.fulfill({json:{events:[],leagues:[],fetchedAt:base.settledAt,source:'ESPN',refreshAfterMs:15000,stale:false}}));
  await page.route('**/api/picks',route=>route.fulfill({json:{tickets}}));
  await page.route('**/api/sports/event?**',route=>route.fulfill({status:404,json:{error:'Unavailable'}}));
  await page.goto('/picks');
  const record = page.getByRole('region',{name:'Pick record',exact:true});
  const results = record.getByRole('list',{name:'Recent results, newest game first'});
  await expect(record.getByText('2 wins in a row')).toBeVisible();
  await expect(results.getByRole('button')).toHaveText(['W','W','L']);
  await expect(results.getByRole('button').first()).toHaveAccessibleName('Latest Boston game · Won');
  await results.getByRole('button',{name:'Older New York game · Lost'}).click();
  const dialog = page.getByRole('dialog',{name:'Game unavailable'});
  await expect(dialog).toContainText('Older New York game');
  await expect(page).toHaveURL(/\/picks\?game=401000001&league=nba$/);
  await dialog.getByRole('button',{name:'Back to My picks'}).click();
  await page.getByRole('searchbox',{name:'Search picks'}).fill('New York');
  const filtered = page.getByRole('region',{name:'Filtered pick record'});
  await expect(filtered.getByText('1 loss in a row')).toBeVisible();
  await expect(filtered.getByRole('list',{name:'Recent results, newest game first'}).getByRole('button')).toHaveText(['L']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('history filters open and settled picks without changing stored records', async ({ page }) => {
  const base={eventId:'401-filter',league:'nba',selection:'Boston Celtics',side:'away',startsAt:new Date(Date.now()+86400000).toISOString(),createdAt:new Date().toISOString(),settledAt:null};
  const tickets=[
    {...base,id:'filter-open',eventName:'Upcoming match',status:'open'},
    {...base,id:'filter-won',eventName:'Completed match',status:'won'},
    {...base,id:'filter-void',eventName:'Voided match',status:'void'},
    {...base,id:'filter-cancelled',eventName:'Cancelled match',status:'cancelled'},
  ];
  await page.route('**/api/account',r=>r.fulfill({json:{user:{id:'filter-user',username:'courtside'}}}));
  await page.route('**/api/sports',r=>r.fulfill({json:{events:[{id:base.eventId,league:'nba',leagueName:'NBA',sport:'basketball',name:'Upcoming match',status:'live',statusText:'3rd Quarter',away:{shortName:'BOS',name:'Boston Celtics',score:68},home:{shortName:'NYK',name:'New York Knicks',score:64}}],leagues:[],fetchedAt:new Date().toISOString(),source:'ESPN',refreshAfterMs:15000,stale:false}}));
  await page.route('**/api/picks',r=>r.fulfill({json:{tickets}}));
  await page.goto('/');
  await page.getByRole('button',{name:'My picks',exact:true}).click();
  await expect(page.locator('.cw-ticket')).toHaveCount(4);
  const record=page.getByRole('region',{name:'Pick record',exact:true});
  await expect(record.getByText('100%',{exact:true})).toBeVisible();
  await expect(record.getByText('Based on 1 confirmed result.')).toBeVisible();
  const filters=page.getByRole('group',{name:'Pick history filters'});
  await filters.getByRole('button',{name:'Open (1)',exact:true}).click();
  await expect(page.locator('.cw-ticket')).toHaveCount(1);
  await expect(page.locator('.cw-ticket')).toContainText('Upcoming match');
  await filters.getByRole('button',{name:'Live (1)',exact:true}).click();
  await expect(page.locator('.cw-ticket')).toHaveCount(1);
  await expect(page.locator('.cw-ticket')).toContainText('BOS 68–64 NYK');
  await filters.getByRole('button',{name:'Settled (3)',exact:true}).click();
  await expect(page.locator('.cw-ticket')).toHaveCount(3);
  await expect(page.locator('.cw-ticket').first()).toContainText('Completed match');
  await filters.getByRole('button',{name:'Void (1)',exact:true}).click();
  await expect(page.locator('.cw-ticket')).toHaveCount(1);
  await expect(page.locator('.cw-ticket')).toContainText('Voided match');
  await filters.getByRole('button',{name:'Cancelled (1)',exact:true}).click();
  await expect(page.locator('.cw-ticket')).toHaveCount(1);
  await expect(page.locator('.cw-ticket')).toContainText('Cancelled match');
  await filters.getByRole('button',{name:'All (4)',exact:true}).click();
  await expect(page.locator('.cw-ticket')).toHaveCount(4);
});

test('My picks finds older entries and opens exact games beyond today’s board', async ({page})=>{
  const base={league:'ufc',side:'home',settledAt:null,startsAt:'2026-09-02T14:00:00Z',status:'won'};
  const past={...base,id:'past-pick',eventId:'401922277',eventName:'Stirling vs Jiří Procházka',
    selection:'Jiří Procházka',createdAt:new Date(Date.now()-43*86_400_000).toISOString()};
  const recent={...base,id:'recent-pick',eventId:'401913646',eventName:'Josh Hokit vs Ciryl Gane',
    selection:'Ciryl Gane',createdAt:new Date().toISOString()};
  const other={...base,id:'other-pick',eventId:'401873052',league:'nfl',eventName:'Washington at New York',
    selection:'Washington',createdAt:new Date().toISOString()};
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/account',r=>r.fulfill({json:{user:{id:'history-user',username:'courtside'}}}));
  await page.route('**/api/sports',r=>r.fulfill({json:{events:[],leagues:[],fetchedAt:new Date().toISOString(),source:'ESPN',refreshAfterMs:15000,stale:false}}));
  await page.route('**/api/picks',r=>r.fulfill({json:{tickets:[recent,past,other]}}));
  await page.route('**/api/sports/event?**',r=>{
    const query=new URL(r.request().url()).searchParams;
    if(query.get('id')!==past.eventId||query.get('league')!==past.league)return r.fulfill({status:404,json:{error:'Unavailable'}});
    return r.fulfill({json:{id:past.eventId,league:past.league,leagueName:'UFC',sport:'mma',status:'final',
      completed:true,winner:'home',statusText:'Final',startsAt:past.startsAt,period:5,clock:'5:00',
      home:{id:'1',name:'Jiří Procházka',shortName:'Procházka',score:null},away:{id:'2',name:'Navajo Stirling',shortName:'Stirling',score:null}}});
  });
  await page.goto('/picks');
  const tickets=page.locator('.cw-ticket');
  await expect(tickets).toHaveCount(3);
  await page.getByRole('combobox',{name:'Pick league'}).selectOption('ufc');
  await page.getByRole('combobox',{name:'When entered'}).selectOption('30');
  await expect(tickets).toHaveCount(1);
  await expect(tickets).toContainText(recent.eventName);
  const search=page.getByRole('searchbox',{name:'Search picks'});
  await search.fill('jiri prochazka');
  await expect(page.getByText('No picks match these filters.')).toBeVisible();
  await page.getByRole('combobox',{name:'When entered'}).selectOption('90');
  await expect(tickets).toHaveCount(1);
  await expect(tickets).toContainText(past.eventName);
  await tickets.getByRole('button',{name:'Game center',exact:true}).click();
  await expect(page).toHaveURL(/\/picks\?game=401922277&league=ufc$/);
  await expect(page.getByRole('dialog',{name:'Game details'})).toContainText('Jiří Procházka');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/picks$/);
  await expect(search).toHaveValue('jiri prochazka');
  await expect(tickets).toContainText(past.eventName);
  await page.getByRole('button',{name:'Clear search filters'}).click();
  await expect(tickets).toHaveCount(3);
  await tickets.filter({hasText:other.eventName}).getByRole('button',{name:'Game center',exact:true}).click();
  await page.getByRole('dialog',{name:'Game unavailable'}).getByRole('button',{name:'Back to My picks',exact:true}).click();
  await expect(page).toHaveURL(/\/picks$/);
  await expect(tickets).toHaveCount(3);
});

test('history sorts by entry, event and result dates and filters a custom entry range', async ({page})=>{
  const base={eventId:'401872925',league:'nfl',selection:'Cincinnati Bengals',side:'home'};
  const tickets=[
    {...base,id:'one',eventName:'First pick',status:'won',createdAt:'2026-11-14T06:30:00Z',startsAt:'2026-11-15T18:00:00Z',settledAt:'2026-11-15T22:00:00Z'},
    {...base,id:'two',eventName:'Second pick',status:'lost',createdAt:'2026-11-14T20:00:00Z',startsAt:'2026-11-14T21:00:00Z',settledAt:'2026-11-14T23:00:00Z'},
    {...base,id:'three',eventName:'Third pick',status:'open',createdAt:'2026-11-16T18:00:00Z',startsAt:'2026-11-21T18:00:00Z',settledAt:null},
  ];
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>localStorage.setItem('cowboy.scheduleZone','America/Los_Angeles'));
  await page.route('**/api/account',r=>r.fulfill({json:{user:{id:'sort-user',username:'courtside'}}}));
  await page.route('**/api/account/follows',r=>r.fulfill({json:{follows:[]}}));
  await page.route('**/api/sports',r=>r.fulfill({json:{events:[],leagues:[],fetchedAt:new Date().toISOString(),source:'ESPN',refreshAfterMs:15000,stale:false}}));
  await page.route('**/api/picks',r=>r.fulfill({json:{tickets}}));
  await page.goto('/picks');
  const cards=page.locator('.cw-ticket h3');
  const sort=page.getByRole('combobox',{name:'Sort picks'});
  await expect(cards).toHaveText(['Third pick','Second pick','First pick']);
  await expect(page.getByRole('region',{name:'Pick record',exact:true}).getByText('50%',{exact:true})).toBeVisible();
  await sort.selectOption('entered-old');
  await expect(cards).toHaveText(['First pick','Second pick','Third pick']);
  await sort.selectOption('game-old');
  await expect(cards).toHaveText(['Second pick','First pick','Third pick']);
  await sort.selectOption('result-new');
  await expect(cards).toHaveText(['First pick','Second pick','Third pick']);
  const states=page.getByRole('group',{name:'Pick history filters'});
  await states.getByRole('button',{name:'Won (1)',exact:true}).click();
  await expect(cards).toHaveText(['First pick']);
  await states.getByRole('button',{name:'Lost (1)',exact:true}).click();
  await expect(cards).toHaveText(['Second pick']);
  await states.getByRole('button',{name:'All (3)',exact:true}).click();
  await page.getByRole('combobox',{name:'When entered'}).selectOption('custom');
  const start=page.getByLabel('From',{exact:true});
  const end=page.getByLabel('Through',{exact:true});
  await start.fill('2026-11-14');
  await end.fill('2026-11-13');
  await expect(page.getByText('The start date must be on or before the end date.')).toBeVisible();
  await start.fill('2026-11-13');
  await expect(cards).toHaveText(['First pick']);
  await expect(page.getByRole('region',{name:'Filtered pick record'}).getByText('100%',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
