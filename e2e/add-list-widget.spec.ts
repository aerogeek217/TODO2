import { expect, test, type Page } from '@playwright/test'
import { openCellMenu, pickSplit, pickWidgetKind, seedWorkspace, wsCell, wsRow, wsTab } from './fixtures/workspace'

/**
 * Adding a List widget (the ⋯'s Add widget…, an empty cell's / layout's List) and
 * switching a tab to List make a new blank list of the layout: its tab
 * appears and Edit list opens beside it at once — no list picker in between
 * — editing the new list live.
 */

/** The list picker the add flow had: gone. */
const noPicker = async (page: Page) => {
  await expect(page.getByText(/^(Add list|Show list)$/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Create new list/ })).toHaveCount(0)
}

const editListDialog = (page: Page, name: string) => page.getByRole('dialog', { name: `Edit list ${name}` })

test('Add widget… (as a tab) › List: the tab appears with the new list\'s own editor, and Save leaves nothing open', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Existing' }],
    layouts: [{ name: 'Main', columns: [{ id: 'col', rows: [wsRow({ id: 'cell', tabs: [{ id: 'notesTab', kind: 'notes' }] })] }] }],
  })
  await openCellMenu(page, 'cell')
  await page.getByRole('menuitem', { name: 'Add widget…' }).click()
  await page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'List' }).click()

  await expect(wsCell(page, 'cell').getByRole('tab', { name: 'New list' })).toHaveAttribute('aria-selected', 'true')
  const editor = editListDialog(page, 'New list')
  await expect(editor).toBeVisible()
  await noPicker(page)

  const name = editor.getByRole('textbox', { name: 'Name' })
  await expect(name).toBeFocused()
  await name.fill('Errands')
  await expect(wsCell(page, 'cell').getByRole('tab', { name: 'Errands' })).toBeVisible()
  await expect(editListDialog(page, 'Errands')).toBeVisible()
  await editListDialog(page, 'Errands').getByRole('button', { name: 'Save list' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(wsCell(page, 'cell').getByRole('tab', { name: 'Errands' })).toBeVisible()
})

test('Change widget › List: the tab shows a new list and Edit list opens beside it', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Existing' }],
    layouts: [{ name: 'Main', columns: [{ id: 'col', rows: [wsRow({ id: 'cell', tabs: [{ id: 'notesTab', kind: 'notes' }] })] }] }],
  })
  // Alone in its cell: the top line stands for the tab, its right-click the ⋯ menu.
  await wsTab(page, 'notesTab').click({ button: 'right' })
  await pickWidgetKind(page, 'Change widget', 'List')

  await expect(wsCell(page, 'cell').getByTestId('top-line-name')).toHaveText('New list')
  await expect(editListDialog(page, 'New list')).toBeVisible()
  await noPicker(page)
})

test('an empty cell’s List: a new list in the cell, its Edit list open', async ({ page }) => {
  await seedWorkspace(page, {
    layouts: [{ name: 'Main', columns: [{ id: 'col', rows: [wsRow({ id: 'cell', tabs: [{ id: 'notesTab', kind: 'notes' }] })] }] }],
  })
  // Split, then the new empty cell's List button.
  await openCellMenu(page, 'cell')
  await pickSplit(page, 'Right')
  const empty = page.locator('[data-ws-cell][data-empty]')
  await empty.getByRole('button', { name: 'List', exact: true }).click()
  await expect(editListDialog(page, 'New list')).toBeVisible()
  await expect(page.getByTestId('top-line-name').filter({ hasText: 'New list' })).toBeVisible()
  await noPicker(page)
})
