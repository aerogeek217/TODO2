import { expect, test, type Locator } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The due-date pill hugs its content where pills remain — phone rows and the
 * top bar's search results: no more than 4px of padding a side (plus the 1px
 * border). On a desktop row the due × is an overlay: it takes no width, so
 * the date stays centred in its slot.
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

test('desktop row: the due × overlays the pill, so the date stays centred', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const chip = page.locator('[data-todo-id]').filter({ hasText: 'Pay the bill' }).locator('[data-pill="due"]')
  await chip.hover()
  const clear = chip.getByRole('button', { name: 'Clear due date' })
  await expect(clear).toBeVisible()
  const gaps = await chip.evaluate((el) => {
    const box = el.getBoundingClientRect()
    // The date's own box: every child but the ×.
    const range = document.createRange()
    range.setStartBefore(el.firstChild!)
    const x = el.querySelector('[aria-label="Clear due date"]')!
    range.setEndBefore(x)
    const content = range.getBoundingClientRect()
    return { left: content.left - box.left, right: box.right - content.right }
  })
  expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(1)
})
