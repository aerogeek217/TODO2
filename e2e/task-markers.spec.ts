import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSettings, seedTaskList, wsCell, wsListWidget, TASK_LIST_TAB } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * Urgent / Important markers and app-wide Urgent: a task due within the
 * "Due date makes a task urgent" range (default 3 days, overdue included)
 * counts as urgent and shows a clock instead of the urgent mark. Turning
 * Urgent off in the task editor asks about the due date (a dialog stacked
 * over the editor). The Markers filter (top bar and a list's own filter)
 * keeps tasks with every ticked marker.
 */

function row(widget: Locator, title: string): Locator {
  return widget.locator('[data-todo-id]', { has: widget.page().locator(`span[data-task-title="${title}"]`) })
}

async function openEditor(page: Page, widget: Locator, title: string): Promise<void> {
  await row(widget, title).locator(`span[data-task-title="${title}"]`).dblclick()
  await expect(page.getByRole('button', { name: 'Urgent', exact: true })).toBeVisible()
}

test('the marker gutter: Focus · Urgent · Important dots; urgent by due date is a ring', async ({ page }) => {
  const widget = await seedTaskList(page, {
    tasks: [
      { title: 'Flagged', urgent: true, important: true, focus: true },
      { title: 'Due soon', dueInDays: 2 },
      { title: 'Overdue', dueInDays: -1 },
      { title: 'Later', dueInDays: 9 },
    ],
  })
  const gutter = (title: string) => row(widget, title).locator('[data-row-cell="markers"]')
  const dots = (title: string) => gutter(title).locator('[data-dot]').evaluateAll((els) => els.map((el) => [el.getAttribute('data-dot'), el.getAttribute('data-on')]))
  await expect(gutter('Flagged')).toHaveAccessibleName('Markers: Focus, Urgent, Important')
  expect(await dots('Flagged')).toEqual([['focus', 'true'], ['urgent', 'flag'], ['important', 'true']])
  await expect(gutter('Due soon')).toHaveAccessibleName('Markers: Urgent (due soon)')
  await expect(gutter('Overdue')).toHaveAccessibleName('Markers: Urgent (due soon)')
  // The ring: no fill, an inset ring in the urgent colour.
  const ring = await gutter('Due soon').locator('[data-dot="urgent"]').evaluate((el) => {
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, shadow: cs.boxShadow }
  })
  expect(ring.bg).toBe('rgba(0, 0, 0, 0)')
  expect(ring.shadow).toContain('inset')
  await expect(gutter('Later')).toHaveAccessibleName('No markers')

  // Settings › Task defaults: range Off → the clocks go; the flag stays.
  const settings = await openSettings(page, 'Task defaults')
  await settings.getByRole('combobox', { name: 'Due date makes a task urgent' }).selectOption('off')
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(gutter('Due soon')).toHaveAccessibleName('No markers')
  await expect(gutter('Flagged')).toHaveAccessibleName('Markers: Focus, Urgent, Important')
})

test('turning Urgent off in the editor on a task urgent by its due date asks to remove the date', async ({ page }) => {
  const widget = await seedTaskList(page, { tasks: [{ title: 'Pick up prescriptions', dueInDays: 2 }] })
  await openEditor(page, widget, 'Pick up prescriptions')
  const urgent = page.getByRole('button', { name: 'Urgent', exact: true })
  await expect(urgent).toHaveAttribute('aria-pressed', 'true')
  await expect(urgent).toHaveAttribute('data-urgent', 'date')

  // Esc closes only the prompt: the editor stays, nothing changed.
  await urgent.click()
  const prompt = page.getByRole('dialog', { name: 'Remove the due date?' })
  await expect(prompt).toContainText('Pick up prescriptions is due')
  await expect(prompt).toContainText('within 3 days, so it counts as urgent. Removing the due date makes it not urgent.')
  await expect(prompt.getByRole('button', { name: 'Remove due date' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(prompt).toBeHidden()
  await expect(urgent).toBeVisible()
  await expect(urgent).toHaveAttribute('aria-pressed', 'true')

  // Remove due date: the date goes, Urgent turns off, the undo snackbar offers it back.
  await urgent.click()
  await page.getByRole('dialog', { name: 'Remove the due date?' }).getByRole('button', { name: 'Remove due date' }).click()
  await expect(urgent).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTitle('Set due date').first()).toBeVisible()
  await expect(page.getByText('Removed the due date')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(row(widget, 'Pick up prescriptions').getByRole('button', { name: 'No markers' })).toBeVisible()
})

test('turning Urgent off on a flagged task due today clears the flag, then offers Keep / Remove due date', async ({ page }) => {
  const widget = await seedTaskList(page, { tasks: [{ title: 'Headcount request', urgent: true, dueInDays: 0 }] })
  await expect(row(widget, 'Headcount request').getByRole('button', { name: 'Markers: Urgent' })).toBeVisible()
  await openEditor(page, widget, 'Headcount request')
  const urgent = page.getByRole('button', { name: 'Urgent', exact: true })
  await expect(urgent).toHaveAttribute('data-urgent', 'flag')
  await urgent.click()
  const prompt = page.getByRole('dialog', { name: 'Still urgent: due today' })
  await expect(prompt).toContainText('Headcount request is no longer flagged urgent, but it’s due today, so it still counts as urgent.')
  await prompt.getByRole('button', { name: 'Keep due date' }).click()
  await expect(prompt).toBeHidden()
  // Still urgent, now by its date: the toggle shows the clock.
  await expect(urgent).toHaveAttribute('data-urgent', 'date')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(row(widget, 'Headcount request').getByRole('button', { name: 'Markers: Urgent (due soon)' })).toBeVisible()
})

const markerTasks = [
  { title: 'Flagged urgent', urgent: true },
  { title: 'Important only', important: true },
  { title: 'Important focus', important: true, focus: true },
  { title: 'Due tomorrow', dueInDays: 1 },
  { title: 'Plain' },
]

test('the top-bar Markers filter (first of the filters) keeps tasks with every ticked marker', async ({ page }) => {
  const widget = await seedTaskList(page, { statuses: ['Doing'], people: ['Ann'], tags: ['home'], tasks: markerTasks })
  await expect.poll(() => rowTitles(widget)).toHaveLength(5)
  await expect(page.getByRole('button', { name: /^Focus filter/ })).toHaveCount(0)
  const names = await page.getByRole('group').filter({ has: page.getByRole('button', { name: 'Markers filter' }) })
    .getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')).filter((n) => n?.endsWith(' filter')))
  expect(names).toEqual(['Markers filter', 'Tags filter', 'People filter', 'Dates filter', 'Status filter'])

  await page.getByRole('button', { name: 'Markers filter' }).click()
  await page.getByRole('checkbox', { name: 'Urgent' }).click()
  await expect.poll(() => rowTitles(widget)).toEqual(['Flagged urgent', 'Due tomorrow'])

  // Several markers AND; the picker stays open for the second pick.
  await page.getByRole('checkbox', { name: 'Urgent' }).click()
  await page.getByRole('checkbox', { name: 'Important' }).click()
  await page.getByRole('checkbox', { name: 'Focus' }).click()
  await expect.poll(() => rowTitles(widget)).toEqual(['Important focus'])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Markers filter: Focus +1' })).toBeVisible()
  await expect(page.locator('[data-filter-row]')).toHaveAttribute('data-filtered', 'true')

  await page.getByRole('button', { name: 'Clear markers filter' }).click()
  await expect.poll(() => rowTitles(widget)).toHaveLength(5)
})

test('a list’s own Markers filter (+ Filter › Markers) narrows the list and is saved with it', async ({ page }) => {
  await seedTaskList(page, { tasks: markerTasks })
  // A screen filter shows the filter row (with its + Filter).
  await page.getByRole('button', { name: 'Show completed' }).click()
  const widget = wsListWidget(page, TASK_LIST_TAB)
  await widget.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Markers' }).click()
  const picker = page.getByTestId('list-filter-picker')
  await picker.getByRole('checkbox', { name: 'Important' }).click()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await expect(widget.getByTestId('list-filter-chip')).toHaveText(/Markers\s*Important/)
  await expect.poll(() => rowTitles(widget)).toEqual(['Important only', 'Important focus'])

  await wsCell(page, 'cell').getByTestId('save-list').click()
  await page.reload()
  await expect.poll(() => rowTitles(wsListWidget(page, TASK_LIST_TAB))).toEqual(['Important only', 'Important focus'])
})
