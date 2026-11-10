import { expect, test } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * The phone's subtasks sheet is a modal dialog (cr31 T9): the focus moves in
 * on open (here the add line: Add subtask…) and comes back to the row on close, Tab
 * stays inside, and a right-click / long-press in it is never the row's task
 * menu (T5).
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [{ title: 'Q4 budget', subtasks: [{ title: 'Template', done: true }, { title: 'Headcount' }] }],
  layouts: [{ name: 'Main', columns: [{ id: 'c', rows: [wsRow({ id: 'k', tabs: [{ id: 't', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

test('the sheet takes the focus, keeps Tab inside, gives the focus back on Esc; its right-click is its own', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const row = page.locator('[data-todo-id]').filter({ hasText: 'Q4 budget' }).first()
  // The quiet phone row's count is text only (2C): the long-press menu's Add subtask… opens the sheet.
  await expect(row.locator('[data-subtask-count]')).toHaveText('1/2')
  await row.dispatchEvent('contextmenu')
  await page.getByRole('menuitem', { name: 'Add subtask…' }).click()
  const sheet = page.getByRole('dialog', { name: 'Subtasks of Q4 budget' })
  await expect(sheet).toHaveAttribute('aria-modal', 'true')
  // Add subtask… opens it on its add line.
  await expect(sheet.getByRole('textbox', { name: 'New subtask' })).toBeFocused()

  // Tab cycles inside: past the last control back to the first.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }

  // A right-click in it opens no task menu over it.
  await sheet.getByRole('textbox', { name: 'New subtask' }).click({ button: 'right' })
  await expect(page.getByRole('menu')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  // Back on the row's button (the long-press put it there).
  await expect(row.getByRole('button', { name: 'Q4 budget' })).toBeFocused()
})
