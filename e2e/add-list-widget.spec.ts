import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsCell } from './fixtures/workspace'

/**
 * "Create new list…" from the add-tab list picker and from Change widget ›
 * List: the new list's tab appears and its own Edit list dialog opens over
 * the workspace — not the Lists manager — and nothing is left open after
 * Save.
 */

const editListDialog = (page: Page, name: string) => page.getByRole('dialog', { name: `Edit list: ${name}` })
const listsManager = (page: Page) => page.getByRole('dialog', { name: 'Lists' })

test('add tab › List › Create new list…: the tab appears with the list\'s own editor, and Save leaves nothing open', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Existing' }],
    layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'notesTab', kind: 'notes' }] }] }] }],
  })
  await wsCell(page, 'cell').getByRole('button', { name: 'Add widget as tab' }).click()
  await page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'List' }).click()
  await page.getByRole('button', { name: /Create new list/ }).click()

  await expect(wsCell(page, 'cell').getByRole('tab', { name: 'New list' })).toHaveAttribute('aria-selected', 'true')
  const editor = editListDialog(page, 'New list')
  await expect(editor).toBeVisible()
  await expect(listsManager(page)).toHaveCount(0)

  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor).toHaveCount(0)
  await expect(listsManager(page)).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Change widget › List › Create new list…: the tab shows the new list and its own editor opens', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Existing' }],
    layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'notesTab', kind: 'notes' }] }] }] }],
  })
  await wsCell(page, 'cell').getByRole('tab', { name: 'Notes' }).click({ button: 'right' })
  await page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitemradio', { name: 'List' }).click()
  await page.getByRole('button', { name: /Create new list/ }).click()

  await expect(wsCell(page, 'cell').getByRole('tab', { name: 'New list' })).toBeVisible()
  await expect(editListDialog(page, 'New list')).toBeVisible()
  await expect(listsManager(page)).toHaveCount(0)
})
