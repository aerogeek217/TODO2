import { expect, test, type Page } from '@playwright/test'
import { openCellMenu, pickSplit, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The glance widgets (D25 N) in a real browser: a Number and a Created vs
 * completed cell added from the grouped add-widget buttons; the Number's
 * metric set from its tab menu; a Number's click opening the task dialog;
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
const number = (page: Page) => page.locator('[data-glance="number"] [data-number-metric]')

test('a Number and a Created vs completed cell come from the grouped add-widget buttons; the Number’s menu sets its metric; a click opens its tasks', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: TASKS,
    listDefinitions: [{ name: 'Everything' }],
    layouts: [{ name: 'Glance', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] }] }],
  })

  // Split below, then the Number from the Numbers & charts group.
  await openCellMenu(page, 'k1')
  await pickSplit(page, 'Below')
  const empty = page.getByRole('region', { name: 'Empty cell' })
  // Tasks: List and Notes; the Calendar is in Numbers & charts (D26).
  await expect(empty.getByRole('group', { name: 'Tasks' }).getByRole('button', { name: 'Notes' })).toBeVisible()
  await expect(empty.getByRole('group', { name: 'Numbers & charts' }).getByRole('button', { name: 'Calendar' })).toBeVisible()
  await empty.getByRole('group', { name: 'Numbers & charts' }).getByRole('button', { name: 'Number', exact: true }).click()
  await expect(number(page)).toHaveAttribute('data-number-metric', 'overdue')
  await expect(number(page).getByTestId('number-count')).toHaveText('2')
  await expect(number(page)).toHaveAttribute('data-lit', 'true')

  // And Created vs completed below it.
  const numberCell = page.locator('[data-ws-cell]').filter({ has: page.locator('[data-glance="number"]') })
  await numberCell.hover()
  await numberCell.getByRole('button', { name: 'Cell options' }).click()
  await pickSplit(page, 'Below')
  await page.getByRole('region', { name: 'Empty cell' }).getByRole('group', { name: 'Numbers & charts' })
    .getByRole('button', { name: 'Created vs completed' }).click()
  await expect(page.locator('[data-glance="trend"] [data-glance-section="trend"]')).toBeVisible()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')

  // The Number's ⋯ menu: Metric › Open — its label (its top line) reads its metric, the count follows.
  const numberTab = numberCell.locator('[data-ws-tab]')
  await expect(numberTab).toContainText('Overdue')
  // Alone in its cell: no tab strip (D26 AA1); a right-click on it opens the ⋯ menu.
  await expect(numberCell.getByRole('tablist')).toHaveCount(0)
  await numberTab.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await menu.getByRole('menuitem', { name: /^Metric/ }).click()
  await page.getByRole('menuitemradio', { name: 'Open', exact: true }).click()
  await expect(number(page)).toHaveAttribute('data-number-metric', 'open')
  await expect(number(page).getByTestId('number-count')).toHaveText('4')
  await expect(numberTab).toContainText('Open')
  // In its fit row it shows its small face (label and count, D25 R); its full widget,
  // opened from the keyboard, has Open's 14 days.
  await expect(number(page)).not.toContainText('in the last 14 days')
  await numberCell.getByRole('button', { name: 'Open Open' }).focus()
  await page.keyboard.press('Enter')
  const full = page.getByTestId('widget-face-popover')
  await expect(full.locator('[data-sparkline]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(full).toHaveCount(0)

  // A click opens its tasks.
  await number(page).click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Open tasks')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(4)
})
