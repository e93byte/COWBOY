import { test, expect } from '@playwright/test';
test('reset requires confirmation and restores independent demo ledgers', async ({ page }) => {
 await page.goto('/');
 await page.getByRole('button', { name: 'Advance scenario' }).click();
 page.once('dialog', dialog => dialog.dismiss());
 await page.getByRole('button', { name: 'Reset practice session' }).click();
 await expect(page.getByText('Scenario 2 / 3')).toBeVisible();
 page.once('dialog', dialog => dialog.accept());
 await page.getByRole('button', { name: 'Reset practice session' }).click();
 await expect(page.getByText('Scenario 1 / 3')).toBeVisible();
 await expect(page.getByTestId('sports-balance')).toHaveText('500.00');
});
