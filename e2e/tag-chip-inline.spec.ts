import { expect, test } from '@playwright/test'
import { seedCanvasWithProjects, taskRowByTitle } from './fixtures/seed'

/**
 * triage-2026-04-27-batch2 P2 — Inline tag chip on task rows (item 1).
 *
 * Adds a `TagChipSelector` shared component parallel to the people/org chip
 * pattern. Click the empty `#` trigger (or any populated `#tag` chip) to open
 * a portaled lookup-or-create dropdown. JSDOM covers the handler wiring;
 * Chromium is authoritative for the portal positioning + computed
 * `getComputedStyle(...).opacity` of the empty trigger on row hover.
 */

test.describe('inline tag chip', () => {
  test('row hover reveals the # trigger; clicking it opens the lookup-or-create dropdown', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'Garden', tasks: ['weed beds'] }],
    })

    const row = taskRowByTitle(page, 'weed beds')
    await expect(row).toBeVisible()

    // The empty-state # trigger is rendered but hover-hidden via CSS until
    // the row receives :hover. Read computed opacity to prove the rule fires.
    const trigger = row.getByLabel('Add tag')
    await expect(trigger).toHaveCount(1)
    const hiddenOpacity = await trigger.evaluate((el) => getComputedStyle(el).opacity)
    expect(parseFloat(hiddenOpacity)).toBeLessThan(0.05)

    await row.hover()
    await expect.poll(async () => parseFloat(await trigger.evaluate((el) => getComputedStyle(el).opacity)))
      .toBeGreaterThan(0.95)

    await trigger.click()
    const search = page.getByPlaceholder('Search tags...')
    await expect(search).toBeVisible()

    // Type a novel tag name + Enter creates the tag, assigns it, and closes
    // the dropdown — the new chip should appear inline on the row.
    await search.fill('p2-test')
    await search.press('Enter')

    await expect(row.getByText('#p2-test')).toBeVisible()
  })
})
