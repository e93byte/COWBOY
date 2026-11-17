import {test,expect} from '@playwright/test';
test('ticket edit requotes, replaces and enforces persisted limit',async({page})=>{
 await page.goto('/'); await page.getByRole('button',{name:'Open Buffalo at Miami'}).click(); await page.getByRole('button',{name:'Buffalo wins · 1.90',exact:true}).click();
 await page.getByRole('button',{name:'Review ticket'}).click(); await page.getByRole('button',{name:'Accept practice ticket'}).click();
 await page.getByRole('button',{name:'My Bets',exact:true}).click(); await page.getByRole('button',{name:'Edit ticket',exact:true}).click();
 await page.getByLabel('Stake · virtual credits',{exact:true}).fill('20'); await page.getByRole('button',{name:'Requote edited ticket'}).click(); await page.getByRole('button',{name:'Accept ticket edit'}).click();
 await expect(page.getByTestId('sports-balance')).toHaveText('480.00'); await expect(page.locator('.ticket')).toHaveCount(1); await expect(page.getByText('20.00',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Account',exact:true}).click();await page.getByLabel('Per-ticket limit').fill('5');await page.getByRole('button',{name:'Save limits'}).click();
 await page.getByRole('button',{name:'Sports',exact:true}).first().click();await page.getByRole('button',{name:'Buffalo wins · 1.90',exact:true}).click();await page.getByRole('button',{name:'Review ticket'}).click();await expect(page.getByRole('status')).toHaveText('Per-ticket stake limit exceeded');
});
test('mobile slip opens, reviews and closes without overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844}); await page.goto('/');
 await page.getByRole('button',{name:'Buffalo wins · 1.90',exact:true}).click(); await page.getByRole('button',{name:'Slip (1)',exact:true}).click();
 await page.getByRole('button',{name:'Review ticket'}).click(); await page.getByRole('button',{name:'Accept practice ticket'}).click();
 await page.getByRole('button',{name:'Close slip',exact:true}).click();await expect(page.getByTestId('sports-balance')).toHaveText('490.00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
