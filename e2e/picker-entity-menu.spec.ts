import { expect, test, type Locator, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'
import { box, expectInsideViewport } from './fixtures/geometry'

/**
 * A right-click on a person or tag in a people / tag picker (or Shift+F10 on
 * the highlighted option) opens the same Show tasks · Edit… · Delete… menu
 * as a task row's avatar / tag, over the picker, without picking the option.
 * Esc closes only the menu; Edit… and Delete… open above the picker, which
 * stays open behind them and shows the change; Show tasks closes the picker.
 * Placement, stacking and focus need a real browser.
 */

const SEED = {
  people: [{ name: 'Alice Chen', initials: 'AC' }, { name: 'Ben Ortiz', initials: 'BO' }],
  tags: ['work', 'home'],
  tasks: [
    { title: 'Plan the offsite', people: ['Alice Chen', 'Ben Ortiz'], tags: ['work'] },
    { title: 'Call the plumber', people: ['Alice Chen'] },
  ],
}

const picker = (page: Page) => page.locator('[data-anchored-picker]')

/** Whether the middle of `locator` is what the page shows on top there. */
async function isOnTop(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!top && el.contains(top)
  })
}

async function openRowPeoplePicker(page: Page): Promise<Locator> {
  await taskRowByTitle(page, 'Plan the offsite').locator('[data-row-cell="people"]').click()
  await expect(picker(page).getByRole('combobox')).toBeFocused()
  return picker(page)
}

test('a right-click on an option opens its menu at the pointer without picking it; Esc closes only the menu', async ({ page }) => {
  await seedTaskList(page, SEED)
  const panel = await openRowPeoplePicker(page)
  const ben = panel.getByRole('option', { name: 'Ben Ortiz' })
  await expect(ben).toHaveAttribute('aria-selected', 'true')
  const b = await box(ben)
  const at = { x: b.x + 40, y: b.y + b.height / 2 }
  await page.mouse.click(at.x, at.y, { button: 'right' })

  const menu = page.getByRole('menu', { name: '@Ben Ortiz' })
  await expect(menu.getByRole('menuitem')).toHaveText(['Show tasks', 'Edit…', 'Delete…'])
  await expect(menu.getByRole('menuitem', { name: 'Show tasks' })).toBeFocused()
  // At the pointer, over the picker; the task menu didn't open behind.
  const m = await box(menu)
  expect(Math.abs(m.x - at.x)).toBeLessThan(6)
  expect(Math.abs(m.y - at.y)).toBeLessThan(6)
  await expectInsideViewport(page, menu)
  expect(await isOnTop(menu)).toBe(true)
  await expect(page.getByRole('menu', { name: 'Task actions' })).toHaveCount(0)
  // Not picked: still assigned, the picker still open.
  await expect(ben).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('combobox')).toBeFocused()
  await expect(ben).toHaveAttribute('aria-selected', 'true')

  // A second Esc is the picker's.
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('Shift+F10 in the search opens the highlighted option’s menu under it', async ({ page }) => {
  await seedTaskList(page, SEED)
  const panel = await openRowPeoplePicker(page)
  await page.keyboard.press('ArrowDown')
  const ben = panel.getByRole('option', { name: 'Ben Ortiz' })
  await expect(ben).toHaveAttribute('data-active', '')
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu', { name: '@Ben Ortiz' })
  await expect(menu.getByRole('menuitem', { name: 'Show tasks' })).toBeFocused()
  const o = await box(ben)
  const m = await box(menu)
  expect(m.y).toBeGreaterThanOrEqual(o.y + o.height - 1)
  expect(m.x).toBeGreaterThan(o.x)
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Edit…' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(panel.getByRole('combobox')).toBeFocused()
})

test('Edit… on a tag opens the Tags editor above the picker; the rename shows in the open picker', async ({ page }) => {
  await seedTaskList(page, SEED)
  await taskRowByTitle(page, 'Plan the offsite').locator('[data-row-cell="tags"]').click()
  const panel = picker(page)
  await expect(panel.getByRole('combobox')).toBeFocused()
  await panel.getByRole('option', { name: 'work' }).click({ button: 'right' })
  await page.getByRole('menu', { name: '#work' }).getByRole('menuitem', { name: 'Edit…' }).click()

  const editor = page.getByRole('dialog', { name: 'Tags' })
  const name = editor.getByPlaceholder('Tag name')
  await expect(name).toHaveValue('work')
  await expect(name).toBeFocused()
  // Stacked above: the picker is still there, under the editor's backdrop.
  await expect(panel).toBeVisible()
  expect(await isOnTop(panel)).toBe(false)
  expect(await isOnTop(name)).toBe(true)

  await name.fill('office')
  // Saving the entry it opened on closes the editor.
  await name.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect(panel.getByRole('option', { name: 'office' })).toBeVisible()
  await expect(panel.getByRole('option', { name: 'work' })).toHaveCount(0)
  await expect(panel.getByRole('combobox')).toBeFocused()
})

test('Delete… asks above the picker; the person leaves the open picker; Undo brings them back', async ({ page }) => {
  await seedTaskList(page, SEED)
  const panel = await openRowPeoplePicker(page)
  await panel.getByRole('option', { name: 'Ben Ortiz' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete person' })
  await expect(confirm).toContainText('Delete Ben Ortiz? Assigned to 1 task.')
  expect(await isOnTop(confirm)).toBe(true)
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(panel.getByRole('option', { name: 'Ben Ortiz' })).toHaveCount(0)
  await expect(panel.getByRole('option', { name: 'Alice Chen' })).toBeVisible()
  await expect(panel.getByRole('combobox')).toBeFocused()
  const row = taskRowByTitle(page, 'Plan the offsite')
  await expect(row.locator('[data-person-avatar="Ben Ortiz"]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(row.locator('[data-person-avatar="Ben Ortiz"]')).toBeVisible()
})

test('Show tasks from the bulk bar’s tag picker closes the picker and opens the tag’s task dialog', async ({ page }) => {
  await seedTaskList(page, SEED)
  await taskRowByTitle(page, 'Plan the offsite').locator('span[data-task-title="Plan the offsite"]').click()
  await taskRowByTitle(page, 'Call the plumber').locator('span[data-task-title="Call the plumber"]').click({ modifiers: ['Shift'] })
  await page.getByTestId('list-bulk-bar').getByRole('button', { name: 'Add tag' }).click()
  const panel = picker(page)
  await panel.getByRole('option', { name: 'work' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show tasks' }).click()
  await expect(panel).toHaveCount(0)
  const dialog = page.locator('[data-task-dialog]')
  await expect(dialog.getByRole('heading')).toHaveText('#work')
  await expect(dialog.locator('[data-todo-id]')).toHaveCount(1)
})

test('the top bar’s People filter: the menu and the editor stack above its picker; Esc steps back one layer at a time', async ({ page }) => {
  await seedTaskList(page, SEED)
  await page.getByRole('button', { name: 'People filter' }).click()
  const filter = page.locator('[class*="dropdownPanel"]').filter({ hasText: '@Ben Ortiz' })
  await expect(filter).toBeVisible()
  await filter.getByText('@Ben Ortiz').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '@Ben Ortiz' })
  await expect(menu).toBeVisible()
  expect(await isOnTop(menu)).toBe(true)
  // Not ticked: the filter stays off.
  await expect(page.getByRole('button', { name: 'People filter', exact: true })).toBeVisible()

  await menu.getByRole('menuitem', { name: 'Edit…' }).click()
  const editor = page.getByRole('dialog', { name: 'People', exact: true })
  await expect(editor.getByPlaceholder('Name')).toHaveValue('Ben Ortiz')
  expect(await isOnTop(editor.getByPlaceholder('Name'))).toBe(true)
  expect(await isOnTop(filter)).toBe(false)

  // The first Esc leaves the editor's edit row, the next closes the editor, then the filter's picker.
  await page.keyboard.press('Escape')
  await expect(editor.getByPlaceholder('Name')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(filter).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(filter).toHaveCount(0)
})

test('the task editor’s people picker: Delete… asks on top and the picker stays open', async ({ page }) => {
  await seedTaskList(page, SEED)
  await taskRowByTitle(page, 'Call the plumber').locator('span[data-task-title="Call the plumber"]').dblclick()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await editor.getByRole('button', { name: '+ Add' }).first().click()
  const options = editor.getByRole('listbox')
  await options.getByRole('option', { name: 'Ben Ortiz' }).click({ button: 'right' })
  await page.getByRole('menu', { name: '@Ben Ortiz' }).getByRole('menuitem', { name: 'Delete…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete person' })
  expect(await isOnTop(confirm)).toBe(true)
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(options.getByRole('option', { name: 'Ben Ortiz' })).toHaveCount(0)
  await expect(options.getByRole('option', { name: 'Alice Chen' })).toBeVisible()
  await expect(editor.getByRole('combobox')).toBeFocused()
})
