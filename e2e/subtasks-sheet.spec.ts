import { expect, test } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The phone's subtasks sheet is a modal dialog (cr31 T9): the focus moves in
 * on open (the first open subtask) and comes back to the chip on close, Tab
 * stays inside, and a right-click / long-press in it is never the row's task
 * menu (T5).
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [{ title: 'Q4 budget', subtasks: [{ title: 'Template', done: true }, { title: 'Headcount' }] }],
  layouts: [{ name: 'Main', columns: [{ id: 'c', cells: [{ id: 'k', tabs: [{ id: 't', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

test('the sheet takes the focus, keeps Tab inside, gives the focus back on Esc; its right-click is its own', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const row = page.locator('[data-todo-id]').filter({ hasText: 'Q4 budget' }).first()
  const chip = row.locator('[data-subtask-count]')
  await chip.click()
  const sheet = page.getByRole('dialog', { name: 'Subtasks of Q4 budget' })
  await expect(sheet).toHaveAttribute('aria-modal', 'true')
  await expect(sheet.getByRole('checkbox', { name: 'Check Headcount' })).toBeFocused()

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
  await expect(chip).toBeFocused()
})
