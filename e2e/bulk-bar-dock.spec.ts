import { expect, test, type Locator, type Page } from '@playwright/test'
import { box } from './fixtures/geometry'
import { selectTaskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * UX cleanup 1A · the bulk bar docks at the widget's foot — a flex child
 * after the scroll — in the list, the Eisenhower and the Neglect map: it
 * covers no row (it floated over the rows under the selection), and in a
 * narrow cell its buttons wrap inside it.
 */

const TASKS: NonNullable<WorkspaceSeed['tasks']> = Array.from({ length: 12 }, (_, i) => ({
  title: `Task ${i + 1}`, urgent: i % 2 === 0, important: i % 3 === 0, dueInDays: i - 3,
}))

function seed(kind: 'lens' | 'eisenhower', leftWeight: number): WorkspaceSeed {
  return {
    listDefinitions: [{ name: 'All' }],
    tasks: TASKS,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', weight: leftWeight, rows: [wsRow({ id: 'a', tabs: [{ id: 'w', kind, ...(kind === 'lens' ? { listDefIdx: 0 } : {}) }] })] },
        { id: 'c2', weight: 1280 - leftWeight, rows: [wsRow({ id: 'b', tabs: [{ id: 'n', kind: 'notes' }] })] },
      ],
    }],
  }
}

/** The bar's box against the rows still in view: none of them under it. */
async function expectNoRowUnder(page: Page, bar: Locator): Promise<void> {
  const b = await box(bar)
  const covered = await page.locator('[data-row-key]').evaluateAll((rows, b) => rows
    .map((r) => r.getBoundingClientRect())
    .filter((r) => r.height > 0 && r.bottom > b.y + 0.5 && r.top < b.y + b.height - 0.5 && r.right > b.x && r.left < b.x + b.width)
    // A row the scroll clips under the bar isn't covered: only what shows counts.
    .filter((r) => {
      const el = document.elementFromPoint(r.left + r.width / 2, Math.max(r.top, b.y) + 1)
      return el != null && !el.closest('[data-testid="list-bulk-bar"]') && el.closest('[data-row-key]') != null
    }).length, b)
  expect(covered).toBe(0)
}

test('a list: the bar docks under the scroll, which makes room for it; in a narrow cell its buttons wrap', async ({ page }) => {
  await seedWorkspace(page, seed('lens', 300))
  await selectTaskRowByTitle(page, 'Task 1')
  await page.locator('[data-row-key]').filter({ hasText: 'Task 2' }).locator('span[data-task-title="Task 2"]').click({ modifiers: ['Shift'] })
  const bar = page.getByTestId('list-bulk-bar')
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('2 selected')
  const cell = await box(wsCell(page, 'a'))
  const b = await box(bar)
  const scroll = await box(page.locator('[data-task-row-grid]').locator('..'))
  // At the foot: under the scroll, inside the cell.
  expect(b.y).toBeGreaterThanOrEqual(scroll.y + scroll.height - 0.5)
  expect(b.y + b.height).toBeLessThanOrEqual(cell.y + cell.height + 0.5)
  expect(b.x).toBeGreaterThanOrEqual(cell.x - 0.5)
  expect(b.x + b.width).toBeLessThanOrEqual(cell.x + cell.width + 0.5)
  await expectNoRowUnder(page, bar)
  // Its buttons all show, on two lines in a cell this narrow.
  await expect(bar.getByRole('button', { name: 'Delete' })).toBeInViewport()
  expect(b.height).toBeGreaterThan(40)
})

test('an Eisenhower: the bar docks under the panes', async ({ page }) => {
  await seedWorkspace(page, seed('eisenhower', 760))
  await selectTaskRowByTitle(page, 'Task 1')
  await page.locator('[data-row-key]').filter({ hasText: 'Task 7' }).locator('span[data-task-title="Task 7"]').click({ modifiers: ['Control'] })
  const bar = page.getByTestId('list-bulk-bar')
  await expect(bar).toBeVisible()
  const panes = await box(page.locator('[data-eisenhower]'))
  const b = await box(bar)
  expect(b.y).toBeGreaterThanOrEqual(panes.y + panes.height - 0.5)
  await expectNoRowUnder(page, bar)
})
