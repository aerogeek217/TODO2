import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { box } from './fixtures/geometry'
import { installRenderCounter, readRenderCounts, resetRenderCounts } from './fixtures/render-count'
import { seedWorkspace, wsListWidget, type WorkspaceSeed, type WsTabSeed } from './fixtures/workspace'

/**
 * What a divider drag costs, held where it is observable without timing.
 * The task-row divider re-lays the rows out without re-rendering them: the
 * rows take their tracks straight from their list's columns, and only an
 * avatars / tags cell whose fit changes re-renders. Nothing is written (view
 * state, kept drafts) until the release, and the release re-renders the
 * widget once but no row. The workspace's column / band dividers re-render
 * no task row either, and keep the unsaved layout in the browser once, at
 * the release — not on every frame. Render counts come from a stand-in
 * React DevTools hook (`fixtures/render-count`), so this holds on any
 * machine — no frame-rate assertions.
 */

const PEOPLE = ['Alice Chen', 'Ben Ortiz', 'Carla Diaz', 'Dee King', 'Eli Moss']
const TAGS = ['planning', 'q4', 'exec', 'finance', 'hiring', 'ops']
const ROWS = 40

/** Rows with every kind of cell filled, spread over the Eisenhower quadrants and the dashboard's Hot / follow-up sections. */
const TASKS: NonNullable<WorkspaceSeed['tasks']> = Array.from({ length: ROWS }, (_, i) => ({
  title: `Task ${i} with a reasonably long title to cut`,
  people: PEOPLE.slice(0, i % 5),
  tags: TAGS.slice(0, i % 6),
  dueInDays: i % 3 === 0 ? undefined : (i % 20) - 4,
  followupInDays: i % 2 === 0 ? -1 : 6,
  status: i % 2 ? 'Waiting' : undefined,
  notes: i % 4 === 0 ? 'Notes' : undefined,
  urgent: i % 2 === 0,
  important: i % 3 !== 0,
  focus: i % 7 === 0,
}))

const WATCHED = ['TaskRow', 'PeopleCell', 'TagsCell', 'ListWidget', 'EisenhowerWidget', 'DashboardWidget']

function seed(tab: Omit<WsTabSeed, 'id'>): WorkspaceSeed {
  return {
    people: PEOPLE,
    tags: TAGS,
    statuses: ['Waiting'],
    listDefinitions: [{ name: 'Everything' }],
    tasks: TASKS,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'w', weight: 900, cells: [{ id: 'cell', tabs: [{ id: 'tab', ...tab }] }] },
        { id: 'rest', weight: 380, cells: [{ id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] }] },
      ],
    }],
  }
}

/** The details width as laid out: from the notes cell's left edge to the row's content edge (8px right padding). */
async function laidOutDetails(r: Locator): Promise<number> {
  const rb = await box(r)
  const nb = await box(r.locator('[data-row-cell="notes"]'))
  return Math.round(rb.x + rb.width - 8 - nb.x)
}

async function storedViewState(page: Page): Promise<Record<string, unknown> | undefined> {
  const layouts = await readStore<{ columns: Array<{ cells: Array<{ tabs: Array<{ id: string; viewState?: Record<string, unknown> }> }> }> }>(page, 'layouts')
  for (const l of layouts) for (const c of l.columns) for (const k of c.cells) for (const t of k.tabs) if (t.id === 'tab') return t.viewState
  return undefined
}

/**
 * Waits until `scope` shows its rows with their people and tags (the
 * assignments load after the tasks), so a later render is the drag's.
 */
async function settled(scope: Locator): Promise<void> {
  await expect(scope.locator('[data-person-avatar]').first()).toBeVisible()
  await expect(scope.locator('[data-tag-name]').first()).toBeVisible()
}

/** Every row of `scope` laid out with `details` (the first few of each list: enough to see they all follow). */
async function expectDetails(scope: Locator, lists: string, details: number): Promise<void> {
  for (const list of await scope.locator(lists).all()) {
    const rows = list.locator('[data-todo-id]')
    const n = Math.min(await rows.count(), 4)
    for (let i = 0; i < n; i++) expect(await laidOutDetails(rows.nth(i))).toBe(details)
  }
}

/** Counts `localStorage` writes from page load on. */
async function countStorageWrites(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __storageWrites: number }
    w.__storageWrites = 0
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      w.__storageWrites++
      return set.call(this, key, value)
    }
  })
}
const storageWrites = (page: Page) => page.evaluate(() => (window as unknown as { __storageWrites: number }).__storageWrites)

/**
 * Presses on `scope`'s divider (near its top: it spans every row), moves
 * `dx` px in `steps` steps, checks `during` while still pressed, and lets go.
 */
async function dragDivider(page: Page, scope: Locator, dx: number, steps: number, during: () => Promise<void>): Promise<void> {
  const handle = scope.locator('[data-task-row-divider]').first()
  // Hovering waits until it's laid out and is what the pointer hits.
  await handle.hover({ position: { x: 4, y: 14 } })
  const d = await box(handle)
  const from = { x: d.x + 4, y: d.y + 14 }
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (dx * i) / steps, from.y)
  await during()
  await page.mouse.up()
}

test('a list: the drag re-lays the rows out live without re-rendering them or the widget; stored on release', async ({ page }) => {
  await installRenderCounter(page, WATCHED)
  await countStorageWrites(page)
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }))
  const widget = wsListWidget(page, 'tab')
  await expect(widget.locator('[data-todo-id]')).toHaveCount(ROWS)
  const first = widget.locator('[data-todo-id]').first()
  expect(await laidOutDetails(first)).toBe(262)
  await settled(widget)
  const writesBefore = await storageWrites(page)
  await resetRenderCounts(page)

  const steps = 20
  await dragDivider(page, widget, -80, steps, async () => {
    // Live: every row follows the drag.
    for (const r of await widget.locator('[data-todo-id]').all()) expect(await laidOutDetails(r)).toBe(342)
    const counts = await readRenderCounts(page)
    expect(counts.TaskRow, 'task rows re-rendered during the drag').toBe(0)
    expect(counts.ListWidget, 'the list widget re-rendered during the drag').toBe(0)
    // Only cells whose avatars / tags fit changed: a few times each over 80px, never once per move.
    expect(counts.PeopleCell! + counts.TagsCell!).toBeLessThan(ROWS * steps / 4)
    // Nothing written yet.
    expect(await storageWrites(page)).toBe(writesBefore)
    expect(await storedViewState(page) ?? {}).toEqual({})
  })
  await expect.poll(() => storedViewState(page)).toEqual({ detailsWidth: 342 })
  // The release writes the view state: the widget re-renders once, its (memoised) rows don't.
  expect((await readRenderCounts(page)).TaskRow).toBe(0)
  for (const r of await widget.locator('[data-todo-id]').all()) expect(await laidOutDetails(r)).toBe(342)
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
})

test('Eisenhower: every quadrant follows the drag without the widget or its rows re-rendering', async ({ page }) => {
  await installRenderCounter(page, WATCHED)
  await seedWorkspace(page, seed({ kind: 'eisenhower' }))
  const eis = page.locator('[data-eisenhower="tab"]')
  await expect(eis.locator('[data-todo-id]')).toHaveCount(ROWS)
  await settled(eis)
  await resetRenderCounts(page)
  await dragDivider(page, eis.locator('[data-eis-quadrant="do"]'), 40, 10, async () => {
    // Every quadrant follows (each clamped to its own room; these all have it).
    await expectDetails(eis, '[data-eis-quadrant]', 222)
    const counts = await readRenderCounts(page)
    expect(counts.TaskRow).toBe(0)
    expect(counts.EisenhowerWidget).toBe(0)
  })
  await expect.poll(() => storedViewState(page)).toEqual({ detailsWidth: 222 })
  // The release writes the view state: the widget re-renders once, its (memoised) rows don't.
  expect((await readRenderCounts(page)).TaskRow).toBe(0)
})

test('dashboard: both task-row sections follow the drag without the widget or its rows re-rendering', async ({ page }) => {
  await installRenderCounter(page, WATCHED)
  await seedWorkspace(page, seed({ kind: 'dashboard', dashboard: { tiles: [], sections: [{ id: 'hot' }, { id: 'followup' }] } }))
  await expect(page.locator('[data-dash-section="followup"] [data-todo-id]').first()).toBeVisible()
  await settled(page.locator('[data-dash-section="followup"]'))
  await resetRenderCounts(page)
  await dragDivider(page, page.locator('[data-dash-section="hot"]'), 40, 10, async () => {
    await expectDetails(page.locator('[data-ws-area]'), '[data-dash-section="hot"], [data-dash-section="followup"]', 222)
    const counts = await readRenderCounts(page)
    expect(counts.TaskRow).toBe(0)
    expect(counts.DashboardWidget).toBe(0)
  })
  await expect.poll(() => storedViewState(page)).toEqual({ detailsWidth: 222 })
  // The release writes the view state: the widget re-renders once, its (memoised) rows don't.
  expect((await readRenderCounts(page)).TaskRow).toBe(0)
})

test('a column or band divider drag: no task row re-renders and the unsaved layout is kept once, at the release', async ({ page }) => {
  await installRenderCounter(page, WATCHED)
  await countStorageWrites(page)
  const layout = seed({ kind: 'lens', listDefIdx: 0 })
  layout.layouts[0]!.top = { id: 'tb', height: 140, tabs: [{ id: 'topnotes', kind: 'notes' }] }
  await seedWorkspace(page, layout)
  const widget = wsListWidget(page, 'tab')
  await expect(widget.locator('[data-todo-id]')).toHaveCount(ROWS)
  const first = widget.locator('[data-todo-id]').first()
  const titleBefore = (await box(first.locator('[data-task-title]'))).width
  const writesBefore = await storageWrites(page)
  await resetRenderCounts(page)

  // The column divider: the list narrows live (its titles give way), nothing kept until the release.
  const d = await box(page.locator('[data-ws-divider="w|rest"]'))
  const from = { x: d.x + d.width / 2, y: d.y + d.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x - 6 * i, from.y)
  await expect.poll(async () => Math.round((await box(first.locator('[data-task-title]'))).width)).toBe(Math.round(titleBefore - 60))
  expect((await readRenderCounts(page)).TaskRow).toBe(0)
  expect(await storageWrites(page)).toBe(writesBefore)
  await page.mouse.up()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
  await expect.poll(() => storageWrites(page)).toBe(writesBefore + 1)

  // The band divider: the same.
  const b = await box(page.locator('[data-ws-band-divider="top"]'))
  const bFrom = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  await page.mouse.move(bFrom.x, bFrom.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(bFrom.x, bFrom.y + 4 * i)
  await expect.poll(async () => Number(await page.locator('[data-ws-band-divider="top"]').getAttribute('aria-valuenow'))).toBe(180)
  expect(await storageWrites(page)).toBe(writesBefore + 1)
  await page.mouse.up()
  await expect.poll(() => storageWrites(page)).toBe(writesBefore + 2)
  expect((await readRenderCounts(page)).TaskRow).toBe(0)

  // Kept: both come back after a reload, still unsaved.
  const widthAfter = (await box(page.locator('[data-ws-column="w"]'))).width
  await page.reload()
  await expect(widget.locator('[data-todo-id]')).toHaveCount(ROWS)
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
  expect(Math.round((await box(page.locator('[data-ws-column="w"]'))).width)).toBe(Math.round(widthAfter))
  await expect(page.locator('[data-ws-band-divider="top"]')).toHaveAttribute('aria-valuenow', '180')
})
