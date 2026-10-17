import { expect, test, type Page } from '@playwright/test'
import { seedTaskList, seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The task dialog in a real browser: a dashboard number opens the tasks it
 * counts; completing one keeps its row (struck through) while the number
 * behind drops; a row opens the editor on top, whose Esc closes only the
 * editor; a list tile's dialog opens the list as a tab (a layout change);
 * the person chip on a task row opens that person's tasks.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SEED: WorkspaceSeed = {
  people: [{ name: 'Alice Chen', initials: 'AC', color: '#e8a25c' }, 'Ben Ortiz'],
  tags: ['q4'],
  listDefinitions: [{ name: 'Alice’s list', people: ['Alice Chen'] }],
  tasks: [
    { title: 'Fix checkout outage', urgent: true, important: true, dueInDays: 0, people: ['Alice Chen'], tags: ['q4'] },
    { title: 'Plan the offsite', focus: true, dueInDays: 3 },
    { title: 'Call the plumber', dueInDays: -2 },
    { title: 'Vendor contract', followupInDays: -1, people: ['Alice Chen', 'Ben Ortiz'] },
  ],
  layouts: [{
    name: 'Dash',
    columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { listTileIdxs: [0] } }] }] }],
  }],
}

const dash = (page: Page) => page.locator('[data-dashboard="dash"]')
const tileCount = (page: Page, id: string) => dash(page).locator(`[data-dash-tile="${id}"]`).getByTestId('dash-tile-count')
const dialog = (page: Page) => page.locator('[data-task-dialog]')
const dialogRow = (page: Page, title: string) => dialog(page).locator('[data-todo-id]').filter({ hasText: title })
const editor = (page: Page) => page.getByRole('textbox', { name: 'Task title' })
const dialogTitles = (page: Page) => dialog(page).locator('[data-todo-id]').evaluateAll((rows) =>
  rows.map((r) => r.querySelector('[data-task-title]')?.textContent ?? ''))

test('a tile opens its tasks; a completed row stays, struck through, while the count drops', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(tileCount(page, 'hot')).toHaveText('2')

  await dash(page).locator('[data-dash-tile="hot"]').click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('heading')).toHaveText('Hot tasks')
  await expect(dialog(page).getByTestId('task-dialog-count')).toHaveText('2')
  await expect(dialog(page)).toContainText('Hot = urgent and important, or in Focus (Settings › Task Defaults).')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(2)

  const outage = dialogRow(page, 'Fix checkout outage')
  await outage.getByRole('checkbox', { name: 'Mark complete' }).click()
  // The count behind drops at once; the row stays, struck through.
  await expect(tileCount(page, 'hot')).toHaveText('1')
  await expect(outage).toBeVisible()
  await expect(outage.getByRole('checkbox', { name: 'Mark incomplete' })).toBeChecked()
  await expect(outage.locator('span[data-task-title="Fix checkout outage"]')).toHaveCSS('text-decoration-line', 'line-through')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(2)

  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  // Reopened, the completed task is gone.
  await dash(page).locator('[data-dash-tile="hot"]').click()
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(1)
})

test('a row opens the editor on top; Esc in the editor closes only the editor', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await dash(page).locator('[data-dash-tile="open"]').click()
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(4)
  // Overdue first, then by due date, undated last.
  expect(await dialogTitles(page)).toEqual(['Call the plumber', 'Fix checkout outage', 'Plan the offsite', 'Vendor contract'])

  // Opened from a row, the editor has the focus: Esc closes it, not the dialog.
  await dialogRow(page, 'Call the plumber').locator('span[data-task-title="Call the plumber"]').click()
  await expect(editor(page)).toHaveValue('Call the plumber')
  await page.keyboard.press('Escape')
  await expect(editor(page)).toHaveCount(0)
  await expect(dialog(page)).toBeVisible()

  await dialogRow(page, 'Plan the offsite').locator('span[data-task-title="Plan the offsite"]').click()
  await expect(editor(page)).toBeVisible()
  // The editor is on top: its fields take clicks over the dialog.
  const progress = page.getByPlaceholder('e.g. 50% done, Waiting on review...')
  await progress.click()
  await progress.fill('Room booked')
  // Esc leaves the field, then closes the editor — never the dialog.
  for (let i = 0; i < 3 && await editor(page).isVisible(); i++) {
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeVisible()
  }
  await expect(editor(page)).toHaveCount(0)
  await expect(dialog(page)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
})

test('a list tile’s dialog opens the list as a tab of the cell, a layout change', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')

  await dash(page).locator('[data-dash-list-tile]').click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Alice’s list')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(2)

  await dialog(page).getByRole('button', { name: 'Open as tab' }).click()
  await expect(dialog(page)).toHaveCount(0)
  const tabs = wsCell(page, 'k1').getByRole('tab')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toContainText('Alice’s list')
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
  await expect(wsTab(page, 'dash')).toBeVisible()
})

test('the person chip on a task row opens that person’s open tasks', async ({ page }) => {
  const widget = await seedTaskList(page, {
    people: ['Alice Chen', 'Ben Ortiz'],
    tasks: [
      { title: 'Vendor contract', people: ['Alice Chen'] },
      { title: 'Sign off on new logo', people: ['Alice Chen'] },
      { title: 'Old thing', people: ['Alice Chen'], isCompleted: true },
      { title: 'Not hers', people: ['Ben Ortiz'] },
    ],
  })
  const row = widget.locator('[data-todo-id]').filter({ hasText: 'Vendor contract' })
  await row.locator('[data-person-avatar]').first().click({ button: 'right' })

  await expect(dialog(page).getByRole('heading')).toHaveText('Alice Chen')
  await expect(dialog(page)).toContainText('Open tasks assigned to Alice Chen.')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(2)
  expect(await dialogTitles(page)).toEqual(['Vendor contract', 'Sign off on new logo'])
  await dialog(page).getByRole('button', { name: 'Close' }).last().click()
  await expect(dialog(page)).toHaveCount(0)
})

test('a row’s status menu and notes popover open above the task dialog', async ({ page }) => {
  await seedWorkspace(page, {
    statuses: ['Waiting'],
    tasks: [{ title: 'Call the plumber', notes: 'Ask about the boiler' }],
    layouts: SEED.layouts,
  })
  await dash(page).locator('[data-dash-tile="open"]').click()
  const row = dialogRow(page, 'Call the plumber')

  // A click is refused if anything covers the target, so these prove the
  // portaled menu / popover are on top of the dialog.
  await row.getByRole('button', { name: 'Set status' }).click()
  await page.getByRole('button', { name: 'Waiting' }).click()
  await expect(row.getByRole('button', { name: 'Status: Waiting' })).toBeVisible()

  await row.getByRole('button', { name: 'Edit notes' }).click()
  const notes = page.getByRole('dialog', { name: 'Task notes' })
  await notes.getByText('Ask about the boiler').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' today')
  await expect(notes).toContainText('Ask about the boiler today')
  await expect(dialog(page)).toBeVisible()
})

test('Esc in a row’s status menu or people picker over the task dialog closes only that', async ({ page }) => {
  await seedWorkspace(page, {
    statuses: ['Waiting'],
    people: ['Alice Chen'],
    tasks: [{ title: 'Call the plumber', people: ['Alice Chen'] }],
    layouts: SEED.layouts,
  })
  await dash(page).locator('[data-dash-tile="open"]').click()
  const row = dialogRow(page, 'Call the plumber')

  await row.getByRole('button', { name: 'Set status' }).click()
  const statusMenu = page.locator('[data-anchored-picker]')
  await expect(statusMenu.getByRole('button', { name: 'Waiting' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(statusMenu).toHaveCount(0)
  await expect(dialog(page)).toBeVisible()

  await row.getByRole('button', { name: 'People: Alice Chen' }).click()
  const people = page.locator('[data-anchored-picker]')
  // Above the dialog: the click lands on the picker, not the dialog under it.
  await people.getByRole('option', { name: /Alice Chen/ }).click()
  await expect(row.getByRole('button', { name: 'Assign people' })).toBeVisible()
  await expect(people.getByRole('combobox')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(people).toHaveCount(0)
  await expect(dialog(page)).toBeVisible()
})
