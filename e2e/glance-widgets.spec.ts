import { expect, test, type Page } from '@playwright/test'
import { pickSplit, seedWorkspace, wsCell, wsRow, wsTab, type WorkspaceSeed } from './fixtures/workspace'

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
  const header = wsCell(page, 'k1').locator('[data-ws-cell-header]')
  await header.hover()
  await header.getByRole('button', { name: 'Cell options' }).click()
  await pickSplit(page, 'Below')
  const empty = page.getByRole('region', { name: 'Empty cell' })
  await expect(empty.getByRole('group', { name: 'Tasks' }).getByRole('button', { name: 'Calendar' })).toBeVisible()
  await empty.getByRole('group', { name: 'Numbers & charts' }).getByRole('button', { name: 'Number', exact: true }).click()
  await expect(number(page)).toHaveAttribute('data-number-metric', 'overdue')
  await expect(number(page).getByTestId('number-count')).toHaveText('2')
  await expect(number(page)).toHaveAttribute('data-lit', 'true')

  // And Created vs completed below it.
  const numberCell = page.locator('[data-ws-cell]').filter({ has: page.locator('[data-glance="number"]') })
  const numberHeader = numberCell.locator('[data-ws-cell-header]')
  await numberCell.hover()
  await numberHeader.getByRole('button', { name: 'Cell options' }).click()
  await pickSplit(page, 'Below')
  await page.getByRole('region', { name: 'Empty cell' }).getByRole('group', { name: 'Numbers & charts' })
    .getByRole('button', { name: 'Created vs completed' }).click()
  await expect(page.locator('[data-glance="trend"] [data-glance-section="trend"]')).toBeVisible()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')

  // The Number's tab menu: Metric › Open — the tab reads its metric, the count follows.
  const numberTab = numberCell.getByRole('tab')
  await expect(numberTab).toContainText('Overdue')
  // A lone Number is headless: its strip slides in on hover.
  await expect(numberCell).toHaveAttribute('data-headless', 'true')
  await numberCell.hover()
  await numberTab.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Change widget' })
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

test('Needs follow-up as a widget: its rows select in its own scope, two show its bulk bar', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: TASKS,
    layouts: [{ name: 'Glance', columns: [
      { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'fu', kind: 'followup', glance: { lookAhead: 3 } }] })] },
      { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 'num', kind: 'number', glance: { metric: 'followupDue' } }] })] },
    ] }],
  })
  const section = page.locator('[data-glance="followup"] [data-glance-section="followup"]')
  await expect(section).toContainText('Late, today and the next 3 days')
  const rows = section.locator('[data-row-key]')
  await expect(rows).toHaveCount(3)
  await rows.nth(0).locator('[data-task-title]').click()
  await rows.nth(1).locator('[data-task-title]').click({ modifiers: ['Control'] })
  await expect(section.locator('[data-selected="true"]')).toHaveCount(2)
  const bar = page.locator('[data-glance="followup"]').getByRole('toolbar', { name: 'Selected tasks' })
  await expect(bar).toBeVisible()
  // The Number beside it is a widget of its own: Follow-up due counts the late and today ones.
  await expect(wsTab(page, 'num')).toContainText('Follow-up due')
  await expect(page.locator('[data-glance="number"]').getByTestId('number-count')).toHaveText('2')
})
