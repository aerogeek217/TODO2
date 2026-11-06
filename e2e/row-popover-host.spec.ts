import { expect, test } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A row's checklist and notes popovers stay open when what is written in
 * them takes the row out of its list (cr31 T1): checking a subtask moves the
 * task's Modified date, which a "not touched in a week" list then drops. The
 * popover stays, with the focus in it, and closes as usual.
 */

const STALE = { match: 'range', start: null, end: { kind: 'offset', days: -7 } }

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Untouched', predicate: { dates: { modified: STALE } } }],
  tasks: [
    { title: 'Q4 budget', modifiedInDays: -20, notes: 'Some notes', subtasks: [{ title: 'Headcount' }, { title: 'Travel' }] },
    { title: 'Other', modifiedInDays: -20 },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c', cells: [{ id: 'k', tabs: [{ id: 't', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

test('a check in the row’s checklist that takes the row out of its list leaves the popover open', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const row = taskRowByTitle(page, 'Q4 budget')
  await row.locator('[data-subtask-count]').click()
  const popover = page.getByRole('dialog', { name: 'Subtasks of Q4 budget' })
  const check = popover.getByRole('checkbox', { name: 'Check Headcount' })
  await expect(check).toBeFocused()
  await check.press('Space')
  // The task's Modified date is now: the list drops it.
  await expect(row).toHaveCount(0)
  await expect(popover).toBeVisible()
  await expect(popover.getByRole('checkbox', { name: 'Uncheck Headcount' })).toBeChecked()
  expect(await popover.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  await popover.getByRole('checkbox', { name: 'Check Travel' }).click()
  await expect(popover.getByRole('checkbox', { name: 'Uncheck Travel' })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
})

test('typed notes that take the row out of its list leave the notes popover open', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const row = taskRowByTitle(page, 'Q4 budget')
  await row.getByRole('button', { name: 'Edit status and notes' }).click()
  const popover = page.getByRole('dialog', { name: 'Status and notes' })
  await expect(popover).toBeVisible()
  await popover.locator('.cm-content').click()
  await page.keyboard.type(' and more')
  await expect(row).toHaveCount(0)
  await expect(popover).toBeVisible()
  await expect(popover.locator('.cm-content')).toContainText('Some notes and more')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
})
