import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The charts of D26 P8 beside the Breakdown (board Z1): a Pivot's cells, a
 * Status flow's segments and a Tag map's tiles each open their tasks in
 * the task dialog.
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
    areas: ['p f', 'm m'],
    cells: [
      { id: 'p', tabs: [{ id: 'pivot', kind: 'pivot' }] },
      { id: 'f', tabs: [{ id: 'flow', kind: 'statusFlow' }] },
      { id: 'm', tabs: [{ id: 'map', kind: 'tagMap' }] },
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


test('a Status flow’s segment opens the tasks in that status at that week’s end', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const flow = chart(page, 'flow')
  await expect(flow.getByTestId('chart-sub')).toHaveText('8 weeks')
  await expect(flow.getByTestId('status-flow-legend')).toContainText('Doing')
  await expect(flow.locator('[data-flow-week]')).toHaveCount(8)
  // Seeded without history: this week holds them, by status now.
  const waiting = flow.getByRole('button', { name: 'Waiting, this week: 2. Show tasks' })
  await waiting.click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Status flow · Waiting · now')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(2)
})

test('a Tag map’s tile, sized by its open tasks and coloured by its late share, opens them', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const map = chart(page, 'map')
  await expect(map.getByTestId('chart-sub')).toHaveText('Every tag')
  await expect(map.locator('[data-tile]')).toHaveCount(3)
  const atlas = map.getByRole('button', { name: '#Project: Atlas: 3 open, 2 late. Show tasks' })
  const northwind = map.getByRole('button', { name: '#Project: Northwind: 1 open, 0 late. Show tasks' })
  const area = async (l: typeof atlas) => {
    const b = (await l.boundingBox())!
    return b.width * b.height
  }
  expect(await area(atlas)).toBeGreaterThan(await area(northwind))
  await atlas.click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Tag map · #Project: Atlas')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(3)
})
