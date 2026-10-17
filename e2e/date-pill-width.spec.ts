import { expect, test, type Locator } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The due-date pill hugs its content where pills remain — phone rows and the
 * top bar's search results: no more than 4px of padding a side (plus the 1px
 * border). On a desktop row the due column's × is an overlay: it takes no
 * width, so the date doesn't move when it appears.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Tasks' }],
  tasks: [{ title: 'Pay the bill', dueInDays: 5 }],
  layouts: [{ name: 'Main', columns: [{ id: 'c', cells: [{ id: 'cell', tabs: [{ id: 'tasks', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

/** The chip's width beyond its content (padding + border + anything reserved). */
async function slack(chip: Locator): Promise<number> {
  return chip.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return el.getBoundingClientRect().width - range.getBoundingClientRect().width
  })
}

test.describe('phone row', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the due pill hugs its date', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const chip = page.locator('[data-todo-id]').filter({ hasText: 'Pay the bill' }).locator('[data-pill="due"]')
    await expect(chip).toBeVisible()
    expect(await slack(chip)).toBeLessThanOrEqual(10.5)
  })
})

test('search results: the due pill hugs its date', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await page.getByPlaceholder('Search…').fill('bill')
  const chip = page.getByRole('listbox', { name: 'Search results' }).locator('[class*="deadlineChip"]')
  await expect(chip).toBeVisible()
  expect(await slack(chip)).toBeLessThanOrEqual(10.5)
})

test('desktop row: the due × overlays the due cell, so the date doesn’t move', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const row = page.locator('[data-todo-id]').filter({ hasText: 'Pay the bill' })
  const date = row.locator('[data-row-cell="due"] span').first()
  const before = (await date.boundingBox())!
  const clear = row.getByRole('button', { name: 'Clear due date' })
  await expect(clear).toHaveCSS('opacity', '0')
  await row.locator('[data-row-cell="due"]').hover()
  await expect(clear).toHaveCSS('opacity', '1')
  expect(await date.boundingBox()).toEqual(before)
  await clear.click()
  await expect(row.getByRole('button', { name: 'Set due date' })).toBeVisible()
})
