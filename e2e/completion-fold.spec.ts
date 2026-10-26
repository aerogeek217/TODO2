import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { seedTaskList, seedWorkspace } from './fixtures/workspace'

/**
 * D19 · completion: ticking a task draws its check and sweeps its strike,
 * the row stays put for a beat, then folds away out of a list that hides
 * completed tasks — with the undo snackbar, whose Undo brings it back.
 * Under reduced motion the row leaves at once (no fold); the snackbar stays.
 * The dashboard's task-row sections do the same.
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

test('a completed row lingers, then folds out of a dashboard section; the count moves at once', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: [
      { title: 'Fix the outage', urgent: true, important: true, dueInDays: 0 },
      { title: 'Collect sign-offs', urgent: true, important: true, dueInDays: 1 },
      { title: 'Plan learning time', urgent: true, important: true, dueInDays: 2 },
    ],
    layouts: [{
      name: 'Dash',
      columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { tiles: ['open'], sections: [{ id: 'hot' }] } }] }] }],
    }],
  })
  const hot = page.locator('[data-dash-section="hot"]')
  await expect(hot.getByTestId('dash-section-count')).toHaveText('3')
  const done = hot.locator('[data-row-todo]', { has: page.locator('span[data-task-title="Collect sign-offs"]') })
  await done.getByRole('checkbox', { name: 'Mark complete' }).click()

  // Still there, completed, lingering — the count has already moved.
  await expect(done.getByRole('checkbox', { name: 'Mark incomplete' })).toBeChecked()
  await expect(hot.locator('[data-leaving="stay"]')).toHaveCount(1)
  await expect(hot.getByTestId('dash-section-count')).toHaveText('2')

  // Then it folds (polled finely: the fold lasts 180 ms), and drops out.
  await expect.poll(() => hot.locator('[data-leaving="fold"]').count(), { intervals: [20] }).toBe(1)
  await expect.poll(() => rowTitles(hot)).toEqual(['Fix the outage', 'Plan learning time'])
  await expect(hot.locator('[data-leaving]')).toHaveCount(0)
})

test('a stale row lingers too, though completing it moves its modified date to now', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: [
      { title: 'Plan the offsite', modifiedInDays: -40 },
      { title: 'Collect sign-offs', modifiedInDays: -30 },
      { title: 'Clean the garage', modifiedInDays: -20 },
    ],
    layouts: [{
      name: 'Dash',
      columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { tiles: ['open'], sections: [{ id: 'stale' }] } }] }] }],
    }],
  })
  const stale = page.locator('[data-dash-section="stale"]')
  await expect.poll(() => rowTitles(stale)).toEqual(['Plan the offsite', 'Collect sign-offs', 'Clean the garage'])
  await stale.locator('[data-row-todo]', { has: page.locator('span[data-task-title="Collect sign-offs"]') })
    .getByRole('checkbox', { name: 'Mark complete' }).click()

  await expect(stale.locator('[data-leaving="stay"]')).toHaveCount(1)
  expect(await rowTitles(stale)).toEqual(['Plan the offsite', 'Collect sign-offs', 'Clean the garage'])
  await expect.poll(() => rowTitles(stale)).toEqual(['Plan the offsite', 'Clean the garage'])
})
