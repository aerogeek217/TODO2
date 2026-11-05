import { expect, test } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A dialog opened from a menu item or a palette command hands the focus
 * back, when it closes, to what opened the menu or had the focus before the
 * palette — never to `body` because the item or the palette's field it
 * started from is gone (cr31 T16, N5).
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [{ title: 'Q4 budget', subtasks: [{ title: 'Headcount' }] }, { title: 'Other task' }],
  layouts: [{ name: 'Main', columns: [{ id: 'c', cells: [{ id: 'k', tabs: [{ id: 't', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

test('a subtask ⋯ › Move to another task… dialog cancelled: the focus is back on ⋯', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await taskRowByTitle(page, 'Q4 budget').locator('span[data-task-title="Q4 budget"]').dblclick()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  const more = editor.getByRole('button', { name: 'Subtask menu: Headcount' })
  await more.click()
  await page.getByRole('menuitem', { name: 'Move to another task…' }).click()
  const picker = page.getByRole('textbox', { name: 'Find a task' })
  await expect(picker).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(more).toBeFocused()
  await expect(editor).toBeVisible()
})

test('a dialog opened from the command palette returns the focus to what had it before the palette', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const newTask = page.getByRole('button', { name: 'New task' })
  await newTask.focus()
  await page.keyboard.press('Control+k')
  const field = page.getByRole('combobox')
  await expect(field).toBeFocused()
  // A task found by the palette opens in the editor at once.
  await field.fill('Other task')
  await expect(page.getByRole('option', { name: /Other task/ })).toBeVisible()
  await page.keyboard.press('Enter')
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(newTask).toBeFocused()
})
