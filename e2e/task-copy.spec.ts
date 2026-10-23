import { expect, test, type Page } from '@playwright/test'
import { selectTaskRowByTitle, taskRowByTitle } from './fixtures/seed'
import { seedTaskList, TASK_LIST_TAB, wsListWidget } from './fixtures/workspace'

/**
 * Copying tasks in a real browser (the clipboard is the system's): the task
 * menu's Copy on a row and on a selection, a list group header's menu,
 * Ctrl+C on selected rows — and Ctrl+C left to the browser in a text field.
 * The clipboard needs real permissions, which JSDOM has no notion of.
 */

/** The clipboard's plain text (the OS clipboard may store line breaks as CRLF). */
const clipboardText = (page: Page) => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))

const groupHeader = (page: Page, name: string) =>
  wsListWidget(page, TASK_LIST_TAB).locator('[data-list-group] button[aria-expanded]').filter({ hasText: name })

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  // Grouped by people: Ann's group (two) shows above Bob's (one), the reverse of the store's order.
  await seedTaskList(page, {
    people: ['Ann', 'Bob'],
    tasks: [
      { title: 'one', people: ['Bob'] },
      { title: 'two', people: ['Ann'] },
      { title: 'three' },
    ],
    list: { grouping: 'people' },
  })
  // Something else on the clipboard first, so every check sees a fresh write.
  await page.evaluate(() => navigator.clipboard.writeText('before'))
})

test('right-click a row → Copy puts that task on the clipboard and says so', async ({ page }) => {
  await taskRowByTitle(page, 'one').locator('span[data-task-title="one"]').click({ button: 'right' })
  const copy = page.getByRole('menuitem', { name: 'Copy', exact: true })
  await expect(copy).toContainText(/Ctrl\+C|⌘C/)
  await copy.click()
  await expect.poll(() => clipboardText(page)).toBe('[ ] one @Bob')
  await expect(page.getByText('Copied 1 task', { exact: true })).toBeVisible()
})

test('a selection: the menu’s Copy N tasks and Ctrl+C copy it in display order; in a text field Ctrl+C copies the text', async ({ page }) => {
  await selectTaskRowByTitle(page, 'one')
  await taskRowByTitle(page, 'two').locator('span[data-task-title="two"]').click({ modifiers: ['ControlOrMeta'] })
  await taskRowByTitle(page, 'one').locator('span[data-task-title="one"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy 2 tasks' }).click()
  await expect.poll(() => clipboardText(page)).toBe('[ ] two @Ann\n[ ] one @Bob')

  await page.evaluate(() => navigator.clipboard.writeText('before'))
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => clipboardText(page)).toBe('[ ] two @Ann\n[ ] one @Bob')
  await expect(page.getByText('Copied 2 tasks', { exact: true })).toBeVisible()

  // The browser's own copy in a text field, the selection still there.
  const search = page.locator('[data-search-input]')
  await search.fill('hello')
  await search.selectText()
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => clipboardText(page)).toBe('hello')
})

test('a group header’s menu copies its group under the group’s name (People and Unassigned alike)', async ({ page }) => {
  await groupHeader(page, 'Ann').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Ann group' })
  await expect(menu.getByRole('menuitem')).toHaveText(['Email check-in: Ann', 'Show all of Ann’s tasks', 'Copy 1 task'])
  await menu.getByRole('menuitem', { name: 'Copy 1 task' }).click()
  await expect.poll(() => clipboardText(page)).toBe('== Ann ==\n[ ] two @Ann')

  await groupHeader(page, 'Unassigned').focus()
  await page.keyboard.press('Shift+F10')
  const unassigned = page.getByRole('menu', { name: 'Unassigned group' })
  await expect(unassigned.getByRole('menuitem')).toHaveText(['Copy 1 task'])
  await unassigned.getByRole('menuitem', { name: 'Copy 1 task' }).click()
  await expect.poll(() => clipboardText(page)).toBe('== Unassigned ==\n[ ] three')
})
