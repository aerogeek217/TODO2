import { expect, test } from '@playwright/test';

test('the workspace mounts at /', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-ws-area]')).toBeVisible();
});

test('former page routes land on the workspace', async ({ page }) => {
  for (const route of ['/#/list', '/#/calendar', '/#/workspace']) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/#\/$/);
    await expect(page.locator('[data-ws-area]')).toBeVisible();
  }
});
