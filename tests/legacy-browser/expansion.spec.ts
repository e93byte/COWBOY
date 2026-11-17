import {test, expect} from '@playwright/test';
test('dense sport navigation filters and opens player markets',async({page})=>{
 await page.goto('/');
 await page.getByRole('navigation',{name:'Sports and leagues'}).getByRole('button',{name:'Hockey'}).click();
 await expect(page.getByRole('heading',{name:'Toronto at Montreal'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Buffalo at Miami'})).toHaveCount(0);
 await page.getByRole('button',{name:'Open Toronto at Montreal'}).click();
 await page.getByRole('button',{name:'Player props',exact:true}).click();
 await page.getByRole('button',{name:'A. Matthews over 4.5 shots · 1.90',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Ticket slip · 1'})).toBeVisible();
});
test('cashout reviewed from ticket and persisted',async({page})=>{
 await page.goto('/'); await page.getByRole('button',{name:'Open Buffalo at Miami'}).click();
 await page.getByRole('button',{name:'Buffalo wins · 1.90',exact:true}).click();
 await page.getByRole('button',{name:'Review ticket'}).click(); await page.getByRole('button',{name:'Accept practice ticket'}).click();
 await page.getByRole('button',{name:'My Bets',exact:true}).first().click();
 await page.getByRole('button',{name:'Review cash-out'}).click();
 await page.getByRole('button',{name:'Accept cash-out'}).click();
 await expect(page.getByText('Status: cashed-out')).toBeVisible(); await page.reload();
 await expect(page.getByTestId('sports-balance')).toHaveText('498.00');
});
test('contest rewards and settings are functional',async({page})=>{
 await page.goto('/'); await page.getByRole('button',{name:'Free Picks',exact:true}).click();
 for(const name of ['Buffalo','Boston','North London']) await page.getByRole('button',{name:`Pick ${name}`,exact:true}).click();
 await page.getByRole('button',{name:'Enter free contest'}).click();
 await page.getByRole('button',{name:'Advance scenario'}).click(); await page.getByRole('button',{name:'Advance scenario'}).click();
 await page.getByRole('button',{name:'Grade contest'}).click(); await expect(page.getByText('3 / 3 correct')).toBeVisible();
 await page.getByRole('button',{name:'Rewards',exact:true}).click(); await page.getByRole('button',{name:'Redeem 100 points'}).click();
 await expect(page.getByTestId('sports-balance')).toHaveText('501.00');
 await page.getByRole('button',{name:'Account',exact:true}).click(); await page.getByLabel('Per-ticket limit').fill('5');
 await page.getByRole('button',{name:'Save limits'}).click(); await page.reload();
 await page.getByRole('button',{name:'Account',exact:true}).click(); await expect(page.getByLabel('Per-ticket limit')).toHaveValue('5');
});
