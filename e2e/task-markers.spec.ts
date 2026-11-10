import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADD_FILTER, closeListFilterEditor, openListFilterEditor, openSettings, seedTaskList, wsCell, wsListWidget, TASK_LIST_TAB } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * Urgent / Important markers and app-wide Urgent: a task due within the
 * "Due date makes a task urgent" range (default 3 days, overdue included)
 * counts as urgent and its checkbox's ring is dashed (D25 B). The Urgent
 * toggles show and flip the flag only — the due date is a hint beside them,
 * never a prompt. The Markers filter (top bar and a list's own filter)
 * keeps tasks with every ticked marker.
 */

function row(widget: Locator, title: string): Locator {
  return widget.locator('[data-todo-id]', { has: widget.page().locator(`span[data-task-title="${title}"]`) })
}

async function openEditor(page: Page, widget: Locator, title: string): Promise<void> {
  await row(widget, title).locator(`span[data-task-title="${title}"]`).dblclick()
  await expect(page.getByRole('button', { name: 'Urgent', exact: true })).toBeVisible()
}

test('the marker gutter names the priority the checkbox ring draws; urgent by due date is the dashed ring', async ({ page }) => {
  const widget = await seedTaskList(page, {
    tasks: [
      { title: 'Flagged', urgent: true, important: true, focus: true },
      { title: 'Due soon', dueInDays: 2 },
      { title: 'Overdue', dueInDays: -1 },
      { title: 'Later', dueInDays: 9 },
    ],
  })
  const gutter = (title: string) => row(widget, title).locator('[data-row-cell="markers"]')
  const ring = (title: string) => row(widget, title).locator('[data-priority-ring]')
  await expect(gutter('Flagged')).toHaveAccessibleName('Priority: Focus, Urgent, Important')
  // Urgent + Important: the split ring; Focus, the glow around it.
  await expect(ring('Flagged')).toHaveAttribute('data-priority-ring', 'split')
  await expect(row(widget, 'Flagged').locator('[data-focus-glow]')).toHaveCount(1)
  await expect(gutter('Due soon')).toHaveAccessibleName('Priority: Urgent (due soon)')
  await expect(gutter('Overdue')).toHaveAccessibleName('Priority: Urgent (due soon)')
  // Urgent by date: the urgent ring, finely dashed, no fill.
  const dashed = await ring('Due soon').locator('[data-ring-part="urgent"]').evaluate((el) => {
    const cs = getComputedStyle(el)
    return { fill: cs.fill, dash: cs.strokeDasharray }
  })
  expect(dashed).toEqual({ fill: 'none', dash: '2px, 1.5px' })
  await expect(gutter('Later')).toHaveAccessibleName('No priority')
  await expect(ring('Later')).toHaveCount(0)

  // Settings › Tasks › Lists & rows: range Off → the clocks go; the flag stays.
  const settings = await openSettings(page, 'Lists & rows')
  await settings.getByRole('combobox', { name: 'Due date makes a task urgent' }).selectOption('off')
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(gutter('Due soon')).toHaveAccessibleName('No priority')
  await expect(ring('Due soon')).toHaveCount(0)
  await expect(gutter('Flagged')).toHaveAccessibleName('Priority: Focus, Urgent, Important')
})

test('the editor’s Urgent toggle is the flag: on a task urgent by its due date it flags and unflags without a prompt', async ({ page }) => {
  const widget = await seedTaskList(page, { tasks: [{ title: 'Pick up prescriptions', dueInDays: 2 }] })
  const gutter = row(widget, 'Pick up prescriptions').locator('[data-row-cell="markers"]')
  await expect(gutter).toHaveAccessibleName('Priority: Urgent (due soon)')
  await openEditor(page, widget, 'Pick up prescriptions')
  const urgent = page.getByRole('button', { name: 'Urgent', exact: true })
  // Unflagged: not pressed, the faint clock says the due date makes it urgent.
  await expect(urgent).toHaveAttribute('aria-pressed', 'false')
  await expect(urgent).toHaveAttribute('data-urgent', 'date')
  await expect(urgent.locator('[data-urgent-hint]')).toBeVisible()
  await urgent.hover()
  await expect(page.getByRole('tooltip')).toContainText('Urgent by due date — due')
  await expect(page.getByRole('tooltip')).toContainText('Click to flag it urgent too.')

  // A click flags it: pressed, no dialog, the editor stays.
  await urgent.click()
  await expect(urgent).toHaveAttribute('aria-pressed', 'true')
  await expect(urgent).toHaveAttribute('data-urgent', 'flag')
  await expect(urgent.locator('[data-urgent-hint]')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: /due date/i })).toHaveCount(0)
  await expect(gutter).toHaveAccessibleName('Priority: Urgent')

  // Another unflags it: the due date stays (still urgent by it), nothing asked.
  await urgent.click()
  await expect(urgent).toHaveAttribute('aria-pressed', 'false')
  await expect(urgent).toHaveAttribute('data-urgent', 'date')
  await expect(page.getByRole('dialog', { name: /due date/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(gutter).toHaveAccessibleName('Priority: Urgent (due soon)')
  await expect(row(widget, 'Pick up prescriptions').locator('[data-row-cell="due"]')).not.toHaveText('')
})

test('a flagged task due today: Urgent pressed, its tooltip says the date keeps it urgent; a click clears only the flag', async ({ page }) => {
  const widget = await seedTaskList(page, { tasks: [{ title: 'Headcount request', urgent: true, dueInDays: 0 }] })
  await expect(row(widget, 'Headcount request').getByRole('button', { name: 'Priority: Urgent' })).toBeVisible()
  await openEditor(page, widget, 'Headcount request')
  const urgent = page.getByRole('button', { name: 'Urgent', exact: true })
  await expect(urgent).toHaveAttribute('aria-pressed', 'true')
  await urgent.hover()
  await expect(page.getByRole('tooltip')).toContainText('Its due date keeps it urgent even unflagged — due today.')
  await urgent.click()
  await expect(urgent).toHaveAttribute('aria-pressed', 'false')
  await expect(urgent).toHaveAttribute('data-urgent', 'date')
  await expect(page.getByRole('dialog', { name: /Still urgent/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(row(widget, 'Headcount request').getByRole('button', { name: 'Priority: Urgent (due soon)' })).toBeVisible()
})

const markerTasks = [
  { title: 'Flagged urgent', urgent: true },
  { title: 'Important only', important: true },
  { title: 'Important focus', important: true, focus: true },
  { title: 'Due tomorrow', dueInDays: 1 },
  { title: 'Plain' },
]

test('the top-bar Priority filter (first of the filters) keeps tasks with any of its values', async ({ page }) => {
  const widget = await seedTaskList(page, { statuses: ['Doing'], people: ['Ann'], tags: ['home'], tasks: markerTasks })
  await expect.poll(() => rowTitles(widget)).toHaveLength(5)
  await expect(page.getByRole('button', { name: /^Focus filter/ })).toHaveCount(0)
  const names = await page.getByRole('group').filter({ has: page.getByRole('button', { name: 'Priority filter' }) })
    .getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')).filter((n) => n?.endsWith(' filter')))
  expect(names).toEqual(['Priority filter', 'Tags filter', 'People filter', 'Dates filter', 'Status filter'])

  const marker = (name: string) => page.getByRole('option', { name })
  await page.getByRole('button', { name: 'Priority filter' }).click()
  await marker('Urgent').click()
  await expect.poll(() => rowTitles(widget)).toEqual(['Flagged urgent', 'Due tomorrow'])

  // Several values OR; the picker stays open for the second pick.
  await marker('Urgent').click()
  await marker('Focus').click()
  await expect.poll(() => rowTitles(widget)).toEqual(['Important focus'])
  await marker('Important').click()
  await expect.poll(() => rowTitles(widget)).toEqual(['Important only', 'Important focus'])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Priority filter: Focus or Important' })).toBeVisible()
  await expect(page.locator('[data-filter-row]')).toHaveAttribute('data-filtered', 'true')

  await page.getByRole('button', { name: 'Clear priority filter' }).click()
  await expect.poll(() => rowTitles(widget)).toHaveLength(5)
})

test('a list’s own Priority filter (Edit list › + Filter › Priority) narrows the list and is saved with it', async ({ page }) => {
  await seedTaskList(page, { tasks: markerTasks })
  await page.getByRole('button', { name: 'Show completed' }).click()
  const widget = wsListWidget(page, TASK_LIST_TAB)
  const editor = await openListFilterEditor(page, widget)
  await editor.getByRole('button', { name: ADD_FILTER }).click()
  await page.getByRole('menuitem', { name: 'Priority' }).click()
  const picker = page.getByTestId('list-filter-picker')
  await picker.getByRole('option', { name: 'Important' }).click()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await expect(editor.getByTestId('list-filter-chip')).toHaveText(/Priority\s*Important/)
  await closeListFilterEditor(page)
  await expect.poll(() => rowTitles(widget)).toEqual(['Important only', 'Important focus'])

  await wsCell(page, 'cell').getByTestId('save-list').click()
  await page.reload()
  await expect.poll(() => rowTitles(wsListWidget(page, TASK_LIST_TAB))).toEqual(['Important only', 'Important focus'])
})
