import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'
import { assignedNames, readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'

/**
 * Quick Add's chip ×: a mouse click on a chip's × edits the typed text — the
 * chip's tokens go, or the default follow-up becomes `/followup none` — and
 * the focus and the caret stay in the field, so typing and ⏎ carry on.
 * Focus handoffs need a real browser.
 */

const SEED = {
  people: [{ name: 'Anna', initials: 'AN' }],
  tasks: [{ title: 'Plan the offsite' }],
}

const bar = (page: Page) => page.getByRole('dialog', { name: 'Quick add task' })
const chips = (page: Page) => bar(page).getByRole('group', { name: 'What the task gets' })

async function openQuickAdd(page: Page): Promise<Locator> {
  await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()
  await page.keyboard.press('Control+Space')
  const input = bar(page).getByPlaceholder('New task…')
  await expect(input).toBeFocused()
  return input
}

interface StoredTask { title: string; dueDate?: Date | null; nextFollowupAt?: Date | null }

async function storedTask(page: Page, title: string): Promise<StoredTask> {
  const task = (await readStore<StoredTask>(page, 'todos')).find((t) => t.title === title)
  if (!task) throw new Error(`no task "${title}"`)
  return task
}

test('a × removes the chip from the text; typing and ⏎ carry on in the field', async ({ page }) => {
  await seedTaskList(page, SEED)
  const input = await openQuickAdd(page)
  await page.keyboard.type('Fix the build #work @Anna /due tomorrow')
  await expect(chips(page)).toContainText('#work')

  await chips(page).getByRole('button', { name: 'Remove #work' }).click()
  await expect(input).toHaveValue('Fix the build @Anna /due tomorrow')
  await expect(input).toBeFocused()
  await expect(chips(page)).not.toContainText('#work')

  await chips(page).getByRole('button', { name: 'Remove due date' }).click()
  await expect(input).toHaveValue('Fix the build @Anna')
  await expect(input).toBeFocused()
  // The caret is still at the end: typing goes on there.
  await page.keyboard.type(' today')
  await expect(input).toHaveValue('Fix the build @Anna today')

  await page.keyboard.press('Enter')
  await expect(bar(page)).toHaveCount(0)
  await expect(taskRowByTitle(page, 'Fix the build today')).toBeVisible()
  const task = await storedTask(page, 'Fix the build today')
  expect(task.dueDate ?? null).toBeNull()
  expect(await assignedNames(page, 'Fix the build today', 'tags')).toEqual([])
  expect(await assignedNames(page, 'Fix the build today')).toEqual(['Anna'])
  expect((await readStore<{ name: string }>(page, 'tags')).map((t) => t.name)).not.toContain('work')
})

test('the follow-up: default → No follow-up and back, and ⏎ adds the task with what shows', async ({ page }) => {
  await seedTaskList(page, SEED)
  let input = await openQuickAdd(page)
  await page.keyboard.type('Vendor call')
  await expect(chips(page)).toContainText('· default')

  await chips(page).getByRole('button', { name: 'No follow-up' }).click()
  await expect(input).toHaveValue('Vendor call /followup none')
  await expect(chips(page)).toHaveText('No follow-up×')
  await expect(input).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(taskRowByTitle(page, 'Vendor call')).toBeVisible()
  expect((await storedTask(page, 'Vendor call')).nextFollowupAt ?? null).toBeNull()

  input = await openQuickAdd(page)
  await page.keyboard.type('Vendor email')
  await chips(page).getByRole('button', { name: 'No follow-up' }).click()
  await chips(page).getByRole('button', { name: 'Use the default follow-up' }).click()
  await expect(input).toHaveValue('Vendor email')
  await expect(chips(page)).toContainText('· default')
  await expect(input).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(taskRowByTitle(page, 'Vendor email')).toBeVisible()
  expect((await storedTask(page, 'Vendor email')).nextFollowupAt).toBeTruthy()
})

test('after a × the focus is in the field, not on a ×: Tab hands off to the editor', async ({ page }) => {
  await seedTaskList(page, SEED)
  const input = await openQuickAdd(page)
  await page.keyboard.type('Write the brief #docs')
  await chips(page).getByRole('button', { name: 'Remove #docs' }).click()
  await expect(input).toHaveValue('Write the brief')
  await expect(input).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(bar(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Create task' })).toBeVisible()
})
