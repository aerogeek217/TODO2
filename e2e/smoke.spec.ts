import { expect, test } from '@playwright/test';

test('canvas viewport mounts', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__viewport')).toBeVisible();
});
