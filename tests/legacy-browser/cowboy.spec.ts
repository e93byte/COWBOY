import {test,expect} from '@playwright/test';
test('COWBOY identity keeps practice disclosure and three-column game lines',async({page})=>{
 await page.goto('/');
 await expect(page).toHaveTitle(/COWBOY/);
 await expect(page.getByRole('link',{name:'COWBOY home'})).toBeVisible();
 await expect(page.getByText('Practice mode · virtual funds',{exact:true})).toBeVisible();
 await expect(page.locator('.board-head')).toContainText('SPREAD');
 await expect(page.locator('.event-row').first().locator('.price-pair')).toHaveCount(3);
 await page.getByRole('button',{name:'Live now',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Seattle at Chicago',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Upcoming',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Seattle at Chicago',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Buffalo at Miami',exact:true})).toHaveCount(0);
});
