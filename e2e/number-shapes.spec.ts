import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed, expectLayoutStep, expectLayoutStored } from './fixtures/workspace'

/**
 * A Number's shapes (D26 P6, board Y): Against a goal — its bar, its pace
 * tick and where it stands, lit while behind or over — and a group of
 * counts in one cell, built in Edit number, each count opening its tasks.
 * Each Number shares its row with a list, so its row isn't a fit row: it
 * shows its whole face.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SEED: WorkspaceSeed = {
  tags: ['Project: Atlas'],
  tasks: [
    { title: 'Late one', dueInDays: -2, tags: ['Project: Atlas'] },
    { title: 'Late two', dueInDays: -1 },
    { title: 'Due soon', dueInDays: 3 },
    { title: 'Undated' },
    { title: 'Closed today', completedInDays: 0 },
  ],
  listDefinitions: [{ name: 'Everything' }, { name: 'Also everything' }],
  layouts: [{
    name: 'Shapes',
    table: {
      areas: ['l1 goal', 'l2 grp'],
      cells: [
        { id: 'l1', tabs: [{ id: 'list1', kind: 'lens', listDefIdx: 0 }] },
        { id: 'goal', tabs: [{ id: 'g', kind: 'number', glance: { metric: 'overdue', name: 'Late', show: 'goal', goal: { atMost: 1 } } }] },
        { id: 'l2', tabs: [{ id: 'list2', kind: 'lens', listDefIdx: 1 }] },
        { id: 'grp', tabs: [{ id: 'n', kind: 'number', glance: { metric: 'open', name: 'Due' } }] },
      ],
    },
  }],
}

const numberIn = (page: Page, tabId: string): Locator => page.locator(`[data-glance-tab="${tabId}"] [data-number]`)
const editor = (page: Page) => page.locator('[data-number-editor]')

async function openEditor(page: Page, tabId: string): Promise<void> {
  await page.locator(`[data-glance-tab="${tabId}"] [data-ws-tab]`).click({ button: 'right' })
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Edit number…' }).click()
  await expect(editor(page)).toBeVisible()
}

async function typeExpression(scope: Locator, text: string): Promise<void> {
  await scope.getByRole('radiogroup', { name: 'Filter mode' }).getByRole('radio', { name: 'Expression' }).click()
  const field = scope.getByRole('textbox', { name: 'Filter expression' })
  await field.fill(text)
  await field.press('Enter')
}

test('against a goal: a bar, where it stands, lit over the limit or behind its pace', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const goal = numberIn(page, 'g')
  await expect(goal).toHaveAttribute('data-show', 'goal')
  // At most 1 late task, and there are 2: over the limit, lit, the bar full.
  await expect(goal.getByTestId('number-count')).toHaveText('2')
  await expect(goal.getByTestId('number-goal-target')).toHaveText('/ 1')
  await expect(goal.getByTestId('number-goal-state')).toHaveText('1 over the limit')
  await expect(goal).toHaveAttribute('data-lit', 'true')
  await expect(goal.getByTestId('number-goal-bar')).toHaveAttribute('data-goal-state', 'over')
  await expect(goal.getByTestId('number-goal-pace')).toHaveCount(0)

  // Edit number: Against a goal's fields only — no Light up when (the goal lights it).
  await openEditor(page, 'g')
  await expect(editor(page).getByTestId('number-editor-show')).toHaveValue('goal')
  await expect(editor(page).getByRole('combobox', { name: 'Light up when' })).toHaveCount(0)
  await expect(editor(page).getByRole('combobox', { name: 'Compare with' })).toHaveCount(0)
  // At least 3 a week: behind its pace unless the week is far enough in — the tick marks the pace.
  await editor(page).getByRole('combobox', { name: 'Goal' }).selectOption('atLeast')
  await editor(page).getByRole('spinbutton', { name: 'Goal: at least' }).fill('3')
  await editor(page).getByRole('combobox', { name: 'Pace' }).selectOption('week')
  await expect(goal.getByTestId('number-goal-target')).toHaveText('/ 3')
  await expect(goal.getByTestId('number-goal-pace')).toBeVisible()
  const paceTitle = await goal.getByTestId('number-goal-pace').getAttribute('title')
  const pace = Number(/Pace: ([\d.]+)/.exec(paceTitle ?? '')?.[1])
  const behind = 2 < pace
  await expect(goal.getByTestId('number-goal-state')).toHaveText(behind ? /^Behind pace/ : /^On pace/)
  if (behind) await expect(goal).toHaveAttribute('data-lit', 'true')
  else await expect(goal).not.toHaveAttribute('data-lit', 'true')
  // At least 2: met, not lit, the bar full.
  await editor(page).getByRole('spinbutton', { name: 'Goal: at least' }).fill('2')
  await expect(goal.getByTestId('number-goal-state')).toHaveText('Goal met')
  await expect(goal).not.toHaveAttribute('data-lit', 'true')
  await expect(goal.getByTestId('number-goal-bar').locator('span').first()).toHaveAttribute('style', /width: 100%/)

  // Show › Count and back: the goal comes back as it was.
  await editor(page).getByTestId('number-editor-show').selectOption('count')
  await expect(goal).toHaveAttribute('data-show', 'count')
  await expect(editor(page).getByRole('combobox', { name: 'Goal' })).toHaveCount(0)
  await editor(page).getByTestId('number-editor-show').selectOption('goal')
  await expect(goal.getByTestId('number-goal-target')).toHaveText('/ 2')
  await expect(editor(page).getByRole('combobox', { name: 'Pace' })).toHaveValue('week')
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor(page)).toHaveCount(0)

  // Its tasks: the late ones.
  await goal.click()
  const dialog = page.locator('[data-task-dialog]')
  await expect(dialog.locator('[data-todo-id]')).toHaveCount(2)
  await page.keyboard.press('Escape')

  // Saved, it reads back after a reload.
  await expectLayoutStored(page)
  await page.reload()
  await expect(numberIn(page, 'g').getByTestId('number-goal-state')).toHaveText('Goal met')
})

test('a group: several counts in one cell, each its own filter, each opening its tasks', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await openEditor(page, 'n')
  await editor(page).getByTestId('number-editor-show').selectOption('group')
  // Its first count is the Number's own: its name and filter (every open task).
  const items = editor(page).getByTestId('number-editor-items')
  await expect(items.getByRole('textbox', { name: 'Count 1 name' })).toHaveValue('Due')
  // The Number's own filter isn't one of a group's fields.
  await expect(editor(page).getByTestId('number-editor-filter')).toHaveCount(0)
  await items.getByRole('textbox', { name: 'Count 1 name' }).fill('Open')
  await items.getByRole('button', { name: 'Add a count' }).click()
  const second = items.getByRole('group', { name: 'Count 2' })
  await second.getByRole('textbox', { name: 'Count 2 name' }).fill('Late')
  await typeExpression(second, 'overdue')
  await items.getByRole('button', { name: 'Add a count' }).click()
  const third = items.getByRole('group', { name: 'Count 3' })
  await third.getByRole('textbox', { name: 'Count 3 name' }).fill('Atlas')
  await typeExpression(third, '#"Project: Atlas"')

  const group = numberIn(page, 'n')
  await expect(group).toHaveAttribute('data-show', 'group')
  await expect(group.getByTestId('number-group-count')).toHaveText(['4', '2', '1'])
  await expect(group.locator('[data-group-item]')).toHaveText([/^4Open$/, /^2Late$/, /^1Atlas$/])
  // Side by side in one row.
  const boxes = await group.locator('[data-group-item]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top))
  expect(new Set(boxes.map(Math.round)).size).toBe(1)

  // Removing a count.
  await items.getByRole('button', { name: 'Remove count 3' }).click()
  await expect(group.getByTestId('number-group-count')).toHaveText(['4', '2'])
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor(page)).toHaveCount(0)
  await expectLayoutStep(page)

  // Each count opens its own tasks.
  await group.getByRole('button', { name: 'Late: 2. Show tasks' }).click()
  const dialog = page.locator('[data-task-dialog]')
  await expect(dialog.getByRole('heading')).toHaveText('Due · Late')
  await expect(dialog.locator('[data-todo-id]')).toHaveCount(2)
  await expect(dialog).toContainText('Late one')
  await expect(dialog).toContainText('Late two')
  await page.keyboard.press('Escape')

  // Saved, it reads back after a reload.
  await expectLayoutStored(page)
  await page.reload()
  await expect(numberIn(page, 'n').getByTestId('number-group-count')).toHaveText(['4', '2'])
})
