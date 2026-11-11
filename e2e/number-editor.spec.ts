import { expect, test, type Page } from '@playwright/test'
import { openCellLayoutMenu, pickSplit, seedWorkspace, wsRow, type WorkspaceSeed, expectLayoutStep, expectLayoutStored } from './fixtures/workspace'

/**
 * A Number is a filter (D26 P5, board X): added from Add widget, its editor
 * opens beside it; an expression typed there sets what it counts; a click
 * opens those tasks; the editor's Save writes it as layout config
 * (unsaved until the layout's Save), which survives a reload once saved.
 * Closing with changes asks Save / Discard / Keep editing.
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
  await openCellLayoutMenu(page, 'k1')
  await pickSplit(page, 'Below')
  await page.getByRole('region', { name: 'Empty cell' }).getByRole('group', { name: 'Insights' })
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
  await expect(editor(page)).toContainText('KeepTags Project: Atlas')
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor(page)).toHaveCount(0)
  await expectLayoutStep(page)

  // Its tasks: the two late Atlas ones, under its name, saying what it counts.
  await number(page).click()
  const dialog = page.locator('[data-task-dialog]')
  await expect(dialog.getByRole('heading')).toHaveText('Late on Atlas')
  await expect(dialog.locator('[data-todo-id]')).toHaveCount(2)
  await expect(dialog).toContainText('Atlas late one')
  await expect(dialog).toContainText('Atlas late two')
  await expect(dialog).toContainText('Overdue · #Project: Atlas')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // Saved, it reads back after a reload.
  await expectLayoutStored(page)
  await page.reload()
  await expect(number(page).getByTestId('number-count')).toHaveText('2')
  await expect(number(page)).toContainText('Late on Atlas')
})

test('closing the editor with changes asks Save / Discard / Keep editing; a press elsewhere goes no further', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await openCellLayoutMenu(page, 'k1')
  await pickSplit(page, 'Below')
  await page.getByRole('region', { name: 'Empty cell' }).getByRole('group', { name: 'Insights' })
    .getByRole('button', { name: 'Number', exact: true }).click()
  await expect(editor(page)).toBeVisible()
  const name = editor(page).getByRole('textbox', { name: 'Name' })
  const save = editor(page).getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeDisabled()

  // An edit: drawn live, Save on.
  await name.fill('Late')
  await expect(number(page)).toContainText('Late')
  await expect(save).toBeEnabled()

  // Esc asks; Keep editing leaves the editor as it was, the focus back in it.
  await page.keyboard.press('Escape')
  const ask = page.getByRole('dialog', { name: 'Save changes to number “Open”?' })
  await expect(ask).toBeVisible()
  await expect(ask.getByRole('button', { name: 'Discard' })).toBeVisible()
  await expect(ask.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await ask.getByRole('button', { name: 'Keep editing' }).click()
  await expect(ask).toHaveCount(0)
  await expect(name).toHaveValue('Late')
  await expect(name).toBeFocused()

  // A press elsewhere (the top bar's gear) asks too, and doesn't reach what it pressed.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(ask).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0)
  // Discard: the new Number stays, as it was added.
  await ask.getByRole('button', { name: 'Discard' }).click()
  await expect(editor(page)).toHaveCount(0)
  await expect(number(page)).toContainText('Open')
  await expect(number(page).getByTestId('number-count')).toHaveText('5')

  // × with changes, then the question's Save: written.
  await page.locator('[data-ws-cell]').filter({ has: number(page) }).locator('[data-ws-tab]').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Edit number…' }).click()
  await expect(editor(page)).toBeVisible()
  await editor(page).getByRole('textbox', { name: 'Name' }).fill('Due')
  await editor(page).getByRole('button', { name: 'Close' }).click()
  await page.getByRole('dialog', { name: 'Save changes to number “Open”?' }).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor(page)).toHaveCount(0)
  await expect(number(page)).toContainText('Due')
})
