import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, seedWorkspace, wsCell, wsTab, type WorkspaceSeed, type WsTabSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Eisenhower widget in a real browser: rows dragged between quadrants and in
 * from a list widget set Urgent / Important; a task urgent by its due date
 * can't be dropped on a not-urgent quadrant (refusal tooltip, nothing
 * changes); the top-bar filter narrows the widget; narrow cells stack with
 * collapsible sections; the tab menu edits the urgent range; a quadrant's
 * "+" opens Quick Add with its flags.
 */

const TASK_LIST = { name: 'Everything', sort: 'deadline' }

function layoutWith(eis: Omit<WsTabSeed, 'id' | 'kind'> = {}, opts: { listWeight?: number } = {}): WorkspaceSeed['layouts'] {
  return [{
    name: 'Main',
    columns: [
      { id: 'colA', weight: opts.listWeight ?? 1, cells: [{ id: 'a1', tabs: [{ id: 'lensTab', kind: 'lens', listDefIdx: 0 }] }] },
      { id: 'colB', weight: 2, cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower', ...eis }] }] },
    ],
  }]
}

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Fix checkout outage', urgent: true, important: true },
  { title: 'Draft OKRs', important: true, dueInDays: 6 },
  { title: 'Send board update', important: true, dueInDays: 12 },
  { title: 'Review analytics', urgent: true },
  { title: 'Pick up prescriptions', dueInDays: 1 },
  { title: 'Review Q4 deck', dueInDays: 9 },
  { title: 'Migrate blog' },
]

const widget = (page: Page) => page.locator('[data-eisenhower="eisTab"]')
const quadrant = (page: Page, q: string) => widget(page).locator(`[data-eis-quadrant="${q}"]`)
const row = (scope: Locator, title: string) => scope.locator('[data-row-key]').filter({ hasText: title })
const listRow = (page: Page, title: string) => row(wsCell(page, 'a1'), title)

async function readFlags(page: Page, title: string): Promise<{ urgent?: boolean; important?: boolean }> {
  const t = (await readStore<{ title: string; urgent?: boolean; important?: boolean }>(page, 'todos')).find((x) => x.title === title)
  if (!t) throw new Error(`no task "${title}"`)
  return { ...(t.urgent !== undefined ? { urgent: t.urgent } : {}), ...(t.important !== undefined ? { important: t.important } : {}) }
}

/** Drags `from` (grabbed near its left edge) onto `to` at `at` (fractions of its box), checking `during` before letting go. */
async function dragOnto(page: Page, from: Locator, to: Locator, during?: () => Promise<void>, at = { x: 0.5, y: 0.6 }): Promise<void> {
  const a = await box(from)
  await drag(page, { x: a.x + 12, y: a.y + a.height / 2 }, await pointIn(to, at.x, at.y), { during })
}

test.describe('dragging between quadrants', () => {
  test('sideways sets Urgent; diagonal changes both, with a preview and one undo step', async ({ page }) => {
    await seedWorkspace(page, { listDefinitions: [TASK_LIST], tasks: TASKS, layouts: layoutWith() })
    await expect(row(quadrant(page, 'schedule'), 'Send board update')).toBeVisible()
    await expect(wsTab(page, 'eisTab')).toContainText('7')

    // Schedule → Do: + Urgent.
    await dragOnto(page, row(quadrant(page, 'schedule'), 'Draft OKRs'), quadrant(page, 'do'), async () => {
      await expect(quadrant(page, 'do')).toHaveAttribute('data-drop-state', 'over')
      await expect(quadrant(page, 'schedule')).toHaveAttribute('data-drop-state', 'current')
      await expect(quadrant(page, 'drop')).toHaveAttribute('data-drop-state', 'valid')
      await expect(quadrant(page, 'do').getByTestId('eisenhower-drop-preview')).toHaveText('+ Urgent')
    })
    await expect(row(quadrant(page, 'do'), 'Draft OKRs')).toBeVisible()
    expect(await readFlags(page, 'Draft OKRs')).toEqual({ urgent: true, important: true })
    await expect(page.getByText('Marked urgent · Draft OKRs')).toBeVisible()

    // Schedule → Delegate (diagonal): + Urgent · − Important.
    await dragOnto(page, row(quadrant(page, 'schedule'), 'Send board update'), quadrant(page, 'delegate'), async () => {
      await expect(quadrant(page, 'delegate').getByTestId('eisenhower-drop-preview')).toHaveText('+ Urgent · − Important')
      await expect(quadrant(page, 'delegate').locator('[data-drop-line]')).toHaveCount(1)
    })
    await expect(row(quadrant(page, 'delegate'), 'Send board update')).toBeVisible()
    expect(await readFlags(page, 'Send board update')).toEqual({ urgent: true })
    const snackbar = page.getByText('Marked urgent, not important · Send board update')
    await expect(snackbar).toBeVisible()

    // One undo step puts it back.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(row(quadrant(page, 'schedule'), 'Send board update')).toBeVisible()
    expect(await readFlags(page, 'Send board update')).toEqual({ important: true })
  })

  test('a list widget row dropped on Schedule becomes important', async ({ page }) => {
    await seedWorkspace(page, { listDefinitions: [TASK_LIST], tasks: TASKS, layouts: layoutWith() })
    await dragOnto(page, listRow(page, 'Review Q4 deck'), quadrant(page, 'schedule'), async () => {
      await expect(quadrant(page, 'schedule')).toHaveAttribute('data-drop-state', 'over')
      // Its own quadrant (Drop) is no target.
      await expect(quadrant(page, 'drop')).toHaveAttribute('data-drop-state', 'current')
      await expect(quadrant(page, 'schedule').getByTestId('eisenhower-drop-preview')).toHaveText('+ Important')
    })
    await expect(row(quadrant(page, 'schedule'), 'Review Q4 deck')).toBeVisible()
    await expect(row(quadrant(page, 'drop'), 'Review Q4 deck')).toHaveCount(0)
    expect(await readFlags(page, 'Review Q4 deck')).toEqual({ important: true })
  })
})

test('a task urgent by its due date can\'t be dropped on a not-urgent quadrant', async ({ page }) => {
  await seedWorkspace(page, { listDefinitions: [TASK_LIST], tasks: TASKS, layouts: layoutWith() })
  const source = row(quadrant(page, 'delegate'), 'Pick up prescriptions')
  await expect(source).toBeVisible()
  await dragOnto(page, source, quadrant(page, 'drop'), async () => {
    await expect(quadrant(page, 'drop')).toHaveAttribute('data-drop-state', 'refused')
    await expect(quadrant(page, 'schedule')).toHaveAttribute('data-drop-state', 'blocked')
    await expect(quadrant(page, 'do')).toHaveAttribute('data-drop-state', 'valid')
    const tip = page.getByTestId('eisenhower-refusal')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('Can’t move to Drop')
    await expect(tip).toContainText('Pick up prescriptions is due')
    await expect(tip).toContainText('within 3 days, so it counts as urgent.')
    await expect(page.locator('html')).toHaveAttribute('data-drop-refused', '')
    // The tooltip stays inside the widget.
    const t = await tip.boundingBox()
    const w = await widget(page).boundingBox()
    expect(t && w && t.x + t.width <= w.x + w.width + 1 && t.y + t.height <= w.y + w.height + 1).toBe(true)
  })
  // Let go: nothing changes.
  await expect(page.getByTestId('eisenhower-refusal')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-drop-refused', '')
  await expect(row(quadrant(page, 'delegate'), 'Pick up prescriptions')).toBeVisible()
  expect(await readFlags(page, 'Pick up prescriptions')).toEqual({})

  // Into Do it goes, and only Important is written.
  await dragOnto(page, row(quadrant(page, 'delegate'), 'Pick up prescriptions'), quadrant(page, 'do'))
  await expect(row(quadrant(page, 'do'), 'Pick up prescriptions')).toBeVisible()
  expect(await readFlags(page, 'Pick up prescriptions')).toEqual({ important: true })
})

test('the top-bar filter narrows the widget', async ({ page }) => {
  await seedWorkspace(page, { listDefinitions: [TASK_LIST], tasks: TASKS, layouts: layoutWith() })
  await expect(widget(page).locator('[data-row-key]')).toHaveCount(7)
  await page.getByPlaceholder('Search…').fill('review')
  await expect(widget(page).locator('[data-row-key]')).toHaveCount(2)
  await expect(row(quadrant(page, 'delegate'), 'Review analytics')).toBeVisible()
  await expect(row(quadrant(page, 'drop'), 'Review Q4 deck')).toBeVisible()
  await expect(wsTab(page, 'eisTab')).toContainText('2 of 7')
  await expect(quadrant(page, 'do')).toContainText('Nothing urgent and important')

  await page.getByPlaceholder('Search…').fill('zzz')
  await expect(widget(page).getByRole('status')).toContainText('All 7 open tasks are hidden by the screen filter.')
  await widget(page).getByRole('button', { name: 'Clear screen filter' }).click()
  await expect(widget(page).locator('[data-row-key]')).toHaveCount(7)
})

test('narrow cells stack; a collapsed section is view state that survives a reload', async ({ page }) => {
  await seedWorkspace(page, { listDefinitions: [TASK_LIST], tasks: TASKS, layouts: layoutWith({}, { listWeight: 3 }) })
  await expect(widget(page)).toHaveAttribute('data-layout', 'stacked')
  await quadrant(page, 'schedule').getByRole('button', { expanded: true }).click()
  await expect(quadrant(page, 'schedule')).toHaveAttribute('data-collapsed', 'true')
  await expect(row(quadrant(page, 'schedule'), 'Draft OKRs')).toHaveCount(0)
  await expect(page.getByTestId('layout-save')).toHaveAttribute('aria-disabled', 'true')
  await page.reload()
  await expect(quadrant(page, 'schedule')).toHaveAttribute('data-collapsed', 'true')
  await expect(quadrant(page, 'schedule').getByTestId('eisenhower-count')).toHaveText('2')
})

test('the tab menu edits the app-wide urgent range', async ({ page }) => {
  await seedWorkspace(page, { listDefinitions: [TASK_LIST], tasks: TASKS, layouts: layoutWith() })
  await expect(row(quadrant(page, 'delegate'), 'Pick up prescriptions')).toBeVisible()
  await wsTab(page, 'eisTab').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Due date makes a task urgent/ }).click()
  const sub = page.getByRole('menu', { name: 'Due date makes a task urgent' })
  await expect(sub.getByRole('menuitemradio', { name: /3 days/ })).toHaveAttribute('aria-checked', 'true')
  await sub.getByRole('menuitemradio', { name: /^Off/ }).click()
  await expect(sub).toHaveCount(0)
  await expect(row(quadrant(page, 'drop'), 'Pick up prescriptions')).toBeVisible()
})

test('a quadrant\'s "+" opens Quick Add with its flags', async ({ page }) => {
  await seedWorkspace(page, { listDefinitions: [TASK_LIST], tasks: TASKS, layouts: layoutWith() })
  await quadrant(page, 'schedule').hover()
  await quadrant(page, 'schedule').getByRole('button', { name: 'Add task to Schedule' }).click()
  const chips = page.getByRole('group', { name: 'What the task gets' })
  await expect(chips).toContainText('Important')
  await expect(chips).toContainText('Adding to Schedule')
  await expect(chips).not.toContainText('Urgent')
  await page.keyboard.type('Book caterer')
  await page.keyboard.press('Enter')
  await expect(row(quadrant(page, 'schedule'), 'Book caterer')).toBeVisible()
  expect(await readFlags(page, 'Book caterer')).toEqual({ important: true })
})
