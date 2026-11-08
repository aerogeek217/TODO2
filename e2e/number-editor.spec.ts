import { expect, test, type Page } from '@playwright/test'
import { pickSplit, seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A Number is a filter (D26 P5, board X): added from Add widget, its editor
 * opens beside it; an expression typed there sets what it counts; a click
 * opens those tasks; the edit is layout config (unsaved until Save) and
 * survives a reload once saved.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SEED: WorkspaceSeed = {
  tags: ['Project: Atlas', 'home'],
  tasks: [
    { title: 'Atlas late one', tags: ['Project: Atlas'], dueInDays: -2 },
    { title: 'Atlas late two', tags: ['Project: Atlas'], dueInDays: -1 },
    { title: 'Atlas on time', tags: ['Project: Atlas'], dueInDays: 3 },
    { title: 'Home late', tags: ['home'], dueInDays: -3 },
    { title: 'Atlas done late', tags: ['Project: Atlas'], dueInDays: -4, isCompleted: true },
    { title: 'Untagged' },
  ],
  listDefinitions: [{ name: 'Everything' }],
  layouts: [{ name: 'Numbers', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

const number = (page: Page) => page.locator('[data-glance="number"] [data-number]')
const editor = (page: Page) => page.locator('[data-number-editor]')

test('add a Number, type a filter, see its count and its tasks', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const header = wsCell(page, 'k1').locator('[data-ws-cell-header]')
  await header.hover()
  await header.getByRole('button', { name: 'Cell options' }).click()
  await pickSplit(page, 'Below')
  await page.getByRole('region', { name: 'Empty cell' }).getByRole('group', { name: 'Numbers & charts' })
    .getByRole('button', { name: 'Number', exact: true }).click()

  // A new Number: every open task, its editor open at once.
  await expect(number(page).getByTestId('number-count')).toHaveText('5')
  await expect(editor(page)).toBeVisible()
  await editor(page).getByRole('textbox', { name: 'Name' }).fill('Late on Atlas')
  await editor(page).getByRole('radiogroup', { name: 'Filter mode' }).getByRole('radio', { name: 'Expression' }).click()
  const field = editor(page).getByRole('textbox', { name: 'Filter expression' })
  await field.fill('overdue and #"Project: Atlas"')
  await field.press('Enter')
  await expect(number(page).getByTestId('number-count')).toHaveText('2')
  // Reads as the chips it holds.
  await expect(editor(page)).toContainText('Reads as')
  await page.keyboard.press('Escape')
  await expect(editor(page)).toHaveCount(0)
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')

  // Its tasks: the two late Atlas ones, under its name, saying what it counts.
  await number(page).click()
  const dialog = page.locator('[data-task-dialog]')
  await expect(dialog.getByRole('heading')).toHaveText('Late on Atlas')
  await expect(dialog.locator('[data-todo-id]')).toHaveCount(2)
  await expect(dialog).toContainText('Atlas late one')
  await expect(dialog).toContainText('Atlas late two')
  await expect(dialog).toContainText('#"Project: Atlas"')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // Saved, it reads back after a reload.
  await page.getByTestId('layout-save').click()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
  await page.reload()
  await expect(number(page).getByTestId('number-count')).toHaveText('2')
  await expect(number(page)).toContainText('Late on Atlas')
})
