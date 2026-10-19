import { expect, test, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'

/**
 * Right-click on a task row's avatar or tag (or the context-menu key on its
 * cell) offers Show tasks · Edit… · Delete… for that person or tag.
 */

const SEED = {
  people: [{ name: 'Alice Chen', initials: 'AC' }, { name: 'Ben Ortiz', initials: 'BO' }],
  tags: ['work'],
  tasks: [
    { title: 'Plan the offsite', people: ['Alice Chen', 'Ben Ortiz'], tags: ['work'] },
    { title: 'Call the plumber', people: ['Alice Chen'] },
    { title: 'Read a book' },
  ],
}

const taskDialog = (page: Page) => page.locator('[data-task-dialog]')

test('an avatar’s menu: Show tasks opens the person’s task dialog, Edit… the editor on them', async ({ page }) => {
  await seedTaskList(page, SEED)
  const row = taskRowByTitle(page, 'Plan the offsite')
  await row.locator('[data-person-avatar="Alice Chen"]').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '@Alice Chen' })
  await expect(menu.getByRole('menuitem')).toHaveText(['Show tasks', 'Edit…', 'Delete…'])
  // Not the task menu.
  await expect(page.getByRole('menu', { name: 'Task actions' })).toHaveCount(0)

  await menu.getByRole('menuitem', { name: 'Show tasks' }).click()
  await expect(taskDialog(page).getByRole('heading')).toHaveText('Alice Chen')
  await expect(taskDialog(page).locator('[data-todo-id]')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(taskDialog(page)).toHaveCount(0)

  await row.locator('[data-person-avatar="Alice Chen"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit…' }).click()
  const editor = page.getByRole('dialog', { name: 'People' })
  const name = editor.getByPlaceholder('Name')
  await expect(name).toHaveValue('Alice Chen')
  await expect(name).toBeFocused()
  await name.fill('Alice Brown')
  // Saving the entry it opened on closes the editor.
  await name.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect(row.locator('[data-person-avatar="Alice Brown"]')).toBeVisible()
})

test('a tag’s menu: Show tasks opens the tag’s task dialog; Delete… asks with the count and is undoable', async ({ page }) => {
  await seedTaskList(page, SEED)
  const row = taskRowByTitle(page, 'Plan the offsite')
  const tag = row.locator('[data-tag-name="work"]')
  await tag.click({ button: 'right' })
  await page.getByRole('menu', { name: '#work' }).getByRole('menuitem', { name: 'Show tasks' }).click()
  await expect(taskDialog(page).getByRole('heading')).toHaveText('#work')
  await expect(taskDialog(page)).toContainText('Open tasks tagged #work.')
  await expect(taskDialog(page).locator('[data-todo-id]')).toHaveCount(1)
  await page.keyboard.press('Escape')

  await tag.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete tag' })
  await expect(confirm).toContainText('Delete work? 1 task currently tagged.')
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(tag).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(tag).toBeVisible()
})

test('the context-menu key on a focused people cell lists each person with their actions', async ({ page }) => {
  await seedTaskList(page, SEED)
  const row = taskRowByTitle(page, 'Plan the offsite')
  const cell = row.locator('[data-row-cell="people"]')
  await cell.focus()
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu', { name: 'People' })
  await expect(menu.getByRole('menuitem')).toHaveText(['@Alice Chen', '@Ben Ortiz'])
  await expect(menu.getByRole('menuitem', { name: '@Alice Chen' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('menuitem', { name: 'Show tasks' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(taskDialog(page).getByRole('heading')).toHaveText('Ben Ortiz')
})

test('Delete… on a person asks with their task count; the avatar goes, Undo brings it back', async ({ page }) => {
  await seedTaskList(page, SEED)
  const row = taskRowByTitle(page, 'Call the plumber')
  await row.locator('[data-person-avatar="Alice Chen"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete person' })
  await expect(confirm).toContainText('Delete Alice Chen? Assigned to 2 tasks.')
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(row.locator('[data-person-avatar]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(row.locator('[data-person-avatar="Alice Chen"]')).toBeVisible()
})
