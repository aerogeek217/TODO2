import { expect, test } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'

/**
 * The task row's tags cell. An empty cell's `#` placeholder is drawn at
 * opacity 0 and shown on row hover; a click on the cell (filled or empty)
 * opens the portaled lookup-or-create dropdown. JSDOM covers the handler
 * wiring; Chromium is authoritative for the portal positioning and the
 * placeholder's computed opacity on row hover.
 */

test.describe('tags cell', () => {
  test('row hover reveals the # placeholder; clicking the cell opens the lookup-or-create dropdown', async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'weed beds' }] })

    const row = taskRowByTitle(page, 'weed beds')
    await expect(row).toBeVisible()

    const trigger = row.getByLabel('Add tag')
    await expect(trigger).toHaveCount(1)
    const readPlaceholderOpacity = () =>
      trigger.evaluate((el) => getComputedStyle(el.querySelector('[aria-hidden="true"]') as HTMLElement).opacity)
    expect(parseFloat(await readPlaceholderOpacity())).toBeLessThan(0.05)

    await row.locator('[data-task-title]').hover()
    await expect.poll(async () => parseFloat(await readPlaceholderOpacity()))
      .toBeGreaterThan(0.95)

    await trigger.click()
    const search = page.getByPlaceholder('Search tags...')
    await expect(search).toBeVisible()

    // Type a novel tag name + Enter creates the tag, assigns it, and closes
    // the dropdown — the new chip should appear inline on the row.
    await search.fill('inline-test')
    await search.press('Enter')

    await expect(row.getByText('#inline-test')).toBeVisible()
  })
})
