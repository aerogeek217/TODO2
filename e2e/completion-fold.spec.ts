import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'

/**
 * D19 · completion: ticking a task draws its check and sweeps its strike,
 * the row stays put for a beat, then folds away out of a list that hides
 * completed tasks — with the undo snackbar, whose Undo brings it back.
 * Under reduced motion the row leaves at once (no fold); the snackbar stays.
 */

const TASKS = [{ title: 'Write the review' }, { title: 'Collect sign-offs' }, { title: 'Plan learning time' }]

const row = (page: Page, title: string) => page.locator('[data-todo-id]', { has: page.locator(`span[data-task-title="${title}"]`) })
const snackbar = (page: Page) => page.getByText('Complete "Collect sign-offs"')

test.use({ viewport: { width: 1000, height: 700 } })

test('a completed row lingers, completed, then folds out of the list; the snackbar undoes it', async ({ page }) => {
  const list = await seedTaskList(page, { tasks: TASKS })
  const done = row(page, 'Collect sign-offs')
  await done.getByRole('checkbox', { name: 'Mark complete' }).click()

  // Still there, completed and struck, lingering.
  await expect(done.getByRole('checkbox', { name: 'Mark incomplete' })).toBeChecked()
  await expect(page.locator('[data-leaving="stay"]')).toHaveCount(1)
  await expect(done.locator('[data-title-text]')).toHaveCSS('background-size', '100% 1.5px')
  await expect(snackbar(page)).toBeVisible()

  // Then it folds, and drops out.
  await expect(page.locator('[data-leaving="fold"]')).toHaveCount(1)
  await expect.poll(() => rowTitles(list)).toEqual(['Write the review', 'Plan learning time'])
  await expect(page.locator('[data-leaving]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => rowTitles(list)).toEqual(['Write the review', 'Collect sign-offs', 'Plan learning time'])
})

test('under reduced motion the row leaves at once, with the snackbar', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const list = await seedTaskList(page, { tasks: TASKS })
  await row(page, 'Collect sign-offs').getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect.poll(() => rowTitles(list)).toEqual(['Write the review', 'Plan learning time'])
  expect(await page.locator('[data-leaving]').count()).toBe(0)
  await expect(snackbar(page)).toBeVisible()
})
