import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The charts of D26 P8 beside the Breakdown (board Z1): a Pivot's cells
 * open their tasks in the task dialog.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Ben Ortiz'],
  statuses: ['Doing', 'Waiting'],
  tags: ['Project: Atlas', 'Project: Northwind'],
  tasks: [
    { title: 'Atlas late', people: ['Aisha Rahman'], status: 'Doing', tags: ['Project: Atlas'], dueInDays: -3 },
    { title: 'Atlas waits', people: ['Aisha Rahman'], status: 'Waiting', tags: ['Project: Atlas'] },
    { title: 'Atlas waits too', people: ['Ben Ortiz'], status: 'Waiting', tags: ['Project: Atlas'], dueInDays: -1 },
    { title: 'Northwind doing', people: ['Ben Ortiz'], status: 'Doing', tags: ['Project: Northwind'], dueInDays: 5 },
    { title: 'Loose end' },
    { title: 'Done already', people: ['Ben Ortiz'], status: 'Waiting', isCompleted: true },
  ],
  layouts: [{ name: 'Charts', table: {
    areas: ['p'],
    cells: [
      { id: 'p', tabs: [{ id: 'pivot', kind: 'pivot' }] },
    ],
  } }],
}

const chart = (page: Page, id: string) => page.locator(`[data-chart="${id}"]`)
const dialog = (page: Page) => page.locator('[data-task-dialog]')

test('a Pivot’s cell and its totals open their tasks', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const pivot = chart(page, 'pivot')
  await expect(pivot.getByTestId('glance-section-count')).toHaveText('5 open')
  await expect(pivot.getByTestId('chart-sub')).toHaveText('People × Status')
  // Rows: people (Unassigned last); columns: the statuses in Settings order, No status last.
  await expect(pivot.locator('[role="rowheader"]')).toHaveText(['Aisha Rahman', 'Ben Ortiz', 'Unassigned', 'Total'])
  await expect(pivot.locator('[role="columnheader"]')).toHaveText(['', 'Doing', 'Waiting', 'No status', 'Total'])
  const cell = pivot.getByRole('button', { name: 'Ben Ortiz × Waiting: 1. Show tasks' })
  await cell.click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Pivot · Ben Ortiz × Waiting')
  await expect(dialog(page)).toContainText('Atlas waits too')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await pivot.getByRole('button', { name: 'Waiting: 2. Show tasks' }).click()
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(2)
})

test('Created vs completed in a narrow cell labels every few days, today always, none colliding', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: [{ title: 'Open one' }],
    layouts: [{ name: 'Trend', table: {
      areas: ['n t n2'],
      cells: [
        { id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] },
        { id: 't', tabs: [{ id: 'trend', kind: 'trend', glance: { range: '14d' } }] },
        { id: 'n2', tabs: [{ id: 'notes2', kind: 'notes' }] },
      ],
      // About 220px at 1440: past the small face (180px), the chart's columns 10px.
      cols: [610, 220, 610],
    } }],
  })
  const axis = page.locator('[data-glance-section="trend"] [data-today="true"]').locator('..')
  await expect(axis.locator('span')).toHaveCount(14)
  await expect(axis.locator('span').last()).not.toBeEmpty()
  const labels = await axis.locator('span').evaluateAll((spans) => spans.map((s) => {
    const range = document.createRange()
    range.selectNodeContents(s)
    const b = range.getBoundingClientRect()
    return { text: s.textContent ?? '', left: b.left, right: b.right }
  }))
  const shown = labels.filter((l) => l.text !== '')
  // Today's label always; fewer than all fourteen; none reaching the next.
  expect(shown.length).toBeGreaterThan(1)
  expect(shown.length).toBeLessThan(14)
  for (let i = 1; i < shown.length; i++) expect(shown[i]!.left).toBeGreaterThan(shown[i - 1]!.right)
})
