import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { seedTaskList, seedWorkspace, wsRow } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * D19 · completion: ticking a task draws its check and sweeps its strike,
 * the row stays put for a beat, then folds away out of a list that hides
 * completed tasks — with the undo snackbar, whose Undo brings it back.
 * Under reduced motion the row leaves at once (no fold); the snackbar stays.
 * The glance row widgets (Stale tasks …) do the same.
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

test('a stale row lingers too, though completing it moves its modified date to now', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: [
      { title: 'Plan the offsite', modifiedInDays: -40 },
      { title: 'Collect sign-offs', modifiedInDays: -30 },
      { title: 'Clean the garage', modifiedInDays: -20 },
    ],
    layouts: [{
      name: 'Dash',
      columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'dash', kind: 'stale' }] })] }],
    }],
  })
  const stale = page.locator('[data-glance-section="stale"]')
  await expect.poll(() => rowTitles(stale)).toEqual(['Plan the offsite', 'Collect sign-offs', 'Clean the garage'])
  await stale.locator('[data-row-todo]', { has: page.locator('span[data-task-title="Collect sign-offs"]') })
    .getByRole('checkbox', { name: 'Mark complete' }).click()

  await expect(stale.locator('[data-leaving="stay"]')).toHaveCount(1)
  expect(await rowTitles(stale)).toEqual(['Plan the offsite', 'Collect sign-offs', 'Clean the garage'])
  await expect.poll(() => rowTitles(stale)).toEqual(['Plan the offsite', 'Clean the garage'])
})

test('completing a task from its editor closes the editor; the row folds with the snackbar, whose Undo brings it back', async ({ page }) => {
  await seedTaskList(page, { tasks: TASKS })
  const done = row(page, 'Collect sign-offs')
  await done.locator('span[data-task-title="Collect sign-offs"]').dblclick()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await editor.locator('input[type="checkbox"]').first().click()
  await expect(editor).toHaveCount(0)
  await expect(snackbar(page)).toBeVisible()
  await expect(done).toHaveCount(0)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(done).toBeVisible()
})

/**
 * A recurring task's finished occurrence lingers shown completed while the
 * task is open on its next date: a tick on that lingering row does nothing,
 * never a second advance that skips an occurrence (cr31 T4).
 */
test('a tick on a recurring task’s lingering occurrence doesn’t advance it again', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'Weekly sync', dueInDays: 3, recurrence: 'weekly' }] })
  const due = async () => {
    const rows = await readStore<{ title: string; dueDate?: string | Date }>(page, 'todos')
    const t = rows.find((r) => r.title === 'Weekly sync')
    return t?.dueDate ? new Date(t.dueDate).getTime() : null
  }
  const first = await due()
  const r = row(page, 'Weekly sync')
  await r.getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect(page.locator('[data-leaving="stay"]')).toHaveCount(1)
  await r.getByRole('checkbox', { name: 'Mark incomplete' }).click()
  // The occurrence folds away and the next one takes its place.
  await expect(page.locator('[data-leaving]')).toHaveCount(0)
  await expect(r.getByRole('checkbox', { name: 'Mark complete' })).toBeVisible()
  const DAY = 24 * 60 * 60 * 1000
  await expect.poll(async () => Math.round((((await due()) ?? 0) - (first ?? 0)) / DAY)).toBe(7)
})
