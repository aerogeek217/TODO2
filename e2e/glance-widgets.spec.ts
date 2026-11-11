import { expect, test, type Page } from '@playwright/test'
import { openCellLayoutMenu, pickSplit, seedWorkspace, wsRow, type WorkspaceSeed, expectLayoutStep } from './fixtures/workspace'

/**
 * The glance widgets (D25 N) in a real browser: a Number and a Created vs
 * completed cell added from the grouped add-widget buttons; the Number's
 * editor opening as it is added, and again from its tab menu; a Number's click opening the task dialog;
 * a row widget's rows selecting in its own scope with its bulk bar.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Fix checkout outage', urgent: true, dueInDays: -1, followupInDays: -1 },
  { title: 'Plan the offsite', focus: true, followupInDays: 0 },
  { title: 'Call the plumber', dueInDays: -2, followupInDays: 2 },
  { title: 'Vendor contract' },
  { title: 'Done already', isCompleted: true },
]

const dialog = (page: Page) => page.locator('[data-task-dialog]')
const number = (page: Page) => page.locator('[data-glance="number"] [data-number]')
const editor = (page: Page) => page.locator('[data-number-editor]')

test('a Number and a Created vs completed cell come from the grouped add-widget buttons; the Number’s editor sets its filter; a click opens its tasks', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: TASKS,
    listDefinitions: [{ name: 'Everything' }],
    layouts: [{ name: 'Glance', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] }] }],
  })

  // Split below, then the Number from the Insights group.
  await openCellLayoutMenu(page, 'k1')
  await pickSplit(page, 'Below')
  const empty = page.getByRole('region', { name: 'Empty cell' })
  // Tasks: List, Calendar, Eisenhower, Review, Notes; Insights: the numbers and charts, and the Neglect map.
  await expect(empty.getByRole('group', { name: 'Tasks' }).getByRole('button', { name: 'Notes' })).toBeVisible()
  await expect(empty.getByRole('group', { name: 'Tasks' }).getByRole('button', { name: 'Calendar' })).toBeVisible()
  await expect(empty.getByRole('group', { name: 'Insights' }).getByRole('button', { name: 'Neglect map' })).toBeVisible()
  await empty.getByRole('group', { name: 'Insights' }).getByRole('button', { name: 'Number', exact: true }).click()
  // A new Number counts every open task, its editor open beside it, its name focused.
  await expect(number(page).getByTestId('number-count')).toHaveText('4')
  await expect(number(page)).not.toHaveAttribute('data-lit', 'true')
  await expect(editor(page)).toBeVisible()
  await expect(editor(page).getByRole('textbox', { name: 'Name' })).toBeFocused()
  await expect(editor(page).getByRole('textbox', { name: 'Name' })).toHaveValue('Open')
  await page.keyboard.press('Escape')
  await expect(editor(page)).toHaveCount(0)

  // And Created vs completed below it.
  const numberCell = page.locator('[data-ws-cell]').filter({ has: page.locator('[data-glance="number"]') })
  await numberCell.hover()
  await numberCell.getByRole('button', { name: 'Cell layout' }).click()
  await pickSplit(page, 'Below')
  await page.getByRole('region', { name: 'Empty cell' }).getByRole('group', { name: 'Insights' })
    .getByRole('button', { name: 'Created vs completed' }).click()
  await expect(page.locator('[data-glance="trend"] [data-glance-section="trend"]')).toBeVisible()
  await expectLayoutStep(page)

  // The Number's ⋯ menu: Edit number… — the filter set as an expression, the name, when it lights.
  const numberTab = numberCell.locator('[data-ws-tab]')
  await expect(numberTab).toContainText('Open')
  // Alone in its cell: no tab strip (D26 AA1); a right-click on it opens the ⋯ menu.
  await expect(numberCell.getByRole('tablist')).toHaveCount(0)
  await numberTab.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await menu.getByRole('menuitem', { name: 'Edit number…' }).click()
  await expect(editor(page)).toBeVisible()
  await editor(page).getByRole('textbox', { name: 'Name' }).fill('Late')
  await editor(page).getByRole('radiogroup', { name: 'Filter mode' }).getByRole('radio', { name: 'Expression' }).click()
  const field = editor(page).getByRole('textbox', { name: 'Filter expression' })
  await field.fill('overdue')
  await field.press('Enter')
  await expect(number(page).getByTestId('number-count')).toHaveText('2')
  await editor(page).getByRole('combobox', { name: 'Light up when' }).selectOption('above')
  await expect(number(page)).toHaveAttribute('data-lit', 'true')
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor(page)).toHaveCount(0)
  await expect(numberTab).toContainText('Late')
  await expectLayoutStep(page)
  // The filter back to none for the rest: every open task.
  await numberTab.click({ button: 'right' })
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Edit number…' }).click()
  await field.fill('')
  await field.press('Enter')
  await expect(number(page).getByTestId('number-count')).toHaveText('4')
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor(page)).toHaveCount(0)
  // In its fit row it shows its small face (label and count, D25 R); its full widget,
  // opened from the keyboard, has Open's 14 days.
  await expect(number(page)).not.toContainText('in the last 14 days')
  await numberCell.getByRole('button', { name: 'Open Late' }).focus()
  await page.keyboard.press('Enter')
  const full = page.getByTestId('widget-face-popover')
  await expect(full.locator('[data-sparkline]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(full).toHaveCount(0)

  // A click opens its tasks.
  await number(page).click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Late')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(4)
})
