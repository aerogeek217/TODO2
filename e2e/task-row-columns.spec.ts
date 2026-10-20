import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { box, pointIn, type Box } from './fixtures/geometry'
import { drag, seedWorkspace, wsListWidget, type WorkspaceSeed, type WsTabSeed } from './fixtures/workspace'

/**
 * The desktop task row's columns: every row of a list shares one set of
 * tracks (markers · checkbox · title │ notes · people · tags · dates (due,
 * follow-up) · status — no ⋯: the task menu is right-click / Shift+F10),
 * every column is always there, hovering shows placeholders by opacity only, and a per-tab divider sets the details
 * width (saved as view state). Layout, hover and drag are real-browser
 * behaviour, so this is the authoritative surface.
 */

const PEOPLE = ['Alice Chen', 'Ben Ortiz', 'Carla Diaz', 'Dee King']
const TAGS = ['planning', 'q4', 'exec']

const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  { title: 'Draft the Q4 roadmap review deck', urgent: true, important: true, focus: true, notes: 'Finance first', people: PEOPLE, tags: TAGS, dueInDays: 1, followupInDays: -2, status: 'Waiting' },
  { title: 'Bare task' },
  { title: 'Book the venue', important: true, people: PEOPLE.slice(0, 2), dueInDays: 12, followupInDays: 4 },
  { title: 'Fix the flaky drop test', focus: true, tags: ['q4'], notes: 'CI only' },
]

/** One widget in a column `width` px wide (of 1280), a notes widget beside it. */
function seed(tab: Omit<WsTabSeed, 'id'>, width: number, tasks = TASKS): WorkspaceSeed {
  return {
    people: PEOPLE,
    tags: TAGS,
    statuses: ['Waiting'],
    listDefinitions: [{ name: 'Everything' }],
    tasks,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'w', weight: width, cells: [{ id: 'cell', tabs: [{ id: 'tab', ...tab }] }] },
        { id: 'rest', weight: 1280 - width, cells: [{ id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] }] },
      ],
    }],
  }
}

const CELLS = ['markers', 'checkbox', 'notes', 'people', 'tags', 'dates', 'due', 'followup', 'status'] as const

/** Every row's cell boxes (by cell name) plus its title box. */
async function cellBoxes(scope: Locator): Promise<Array<Record<string, Box>>> {
  return scope.locator('[data-todo-id]').evaluateAll((rows) => rows.map((row) => {
    const out: Record<string, Box> = {}
    const add = (name: string, el: Element | null) => {
      if (!el) return
      const b = el.getBoundingClientRect()
      out[name] = { x: b.x, y: b.y, width: b.width, height: b.height }
    }
    // (The date parts' × overlays are not columns.)
    for (const el of Array.from(row.querySelectorAll('[data-row-cell]:not([data-row-cell$="-clear"])'))) add(el.getAttribute('data-row-cell')!, el)
    add('title', row.querySelector('[data-task-title]'))
    return out
  }))
}

const row = (scope: Locator, title: string) => scope.locator('[data-todo-id]').filter({ has: scope.page().locator(`[data-task-title="${title}"]`) })
const divider = (scope: Locator) => scope.locator('[data-task-row-divider]').first()
const dividerValue = async (scope: Locator) => Number(await divider(scope).getAttribute('aria-valuenow'))

/** The details width as laid out: from the notes cell's left edge to the row's content edge (8px right padding). */
async function laidOutDetails(r: Locator): Promise<number> {
  const rb = await box(r)
  const nb = await box(r.locator('[data-row-cell="notes"]'))
  return Math.round(rb.x + rb.width - 8 - nb.x)
}

async function storedTabView(page: Page, tabId: string): Promise<Record<string, unknown> | undefined> {
  const layouts = await readStore<{ columns: Array<{ cells: Array<{ tabs: Array<{ id: string; viewState?: Record<string, unknown> }> }> }> }>(page, 'layouts')
  for (const l of layouts) for (const c of l.columns) for (const k of c.cells) for (const t of k.tabs) if (t.id === tabId) return t.viewState
  return undefined
}

test('each column lines up across rows, filled or empty, in one order', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 640))
  const widget = wsListWidget(page, 'tab')
  await expect(widget.locator('[data-todo-id]')).toHaveCount(TASKS.length)
  const rows = await cellBoxes(widget)
  for (const r of rows) {
    // Every column, in order left to right.
    expect(Object.keys(r).filter((k) => k !== 'title')).toEqual([...CELLS])
    const xs = CELLS.map((c) => r[c]!.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  }
  for (const name of [...CELLS, 'title']) {
    const lefts = rows.map((r) => Math.round(r[name]!.x * 2) / 2)
    const widths = rows.map((r) => Math.round(r[name]!.width * 2) / 2)
    expect(new Set(lefts).size, `${name} x across rows`).toBe(1)
    expect(new Set(widths).size, `${name} width across rows`).toBe(1)
  }
})

test('status is the last column, flush with the row’s right padding; the default split keeps people and tags their room beside both dates', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 640))
  const widget = wsListWidget(page, 'tab')
  await expect(widget.locator('[data-todo-id]')).toHaveCount(TASKS.length)
  for (const r of await widget.locator('[data-todo-id]').all()) {
    const rb = await box(r)
    const status = await box(r.locator('[data-row-cell="status"]'))
    expect(Math.round(rb.x + rb.width - 8 - (status.x + status.width))).toBe(0)
    // The default details width (300) holds both dates and people / tags at about their old room.
    expect(await laidOutDetails(r)).toBe(300)
  }
  const busy = row(widget, 'Draft the Q4 roadmap review deck')
  expect(Math.round((await box(busy.locator('[data-row-cell="people"]'))).width)).toBe(53)
  expect(Math.round((await box(busy.locator('[data-row-cell="tags"]'))).width)).toBe(79)
  expect(Math.round((await box(busy.locator('[data-row-cell="dates"]'))).width)).toBe(112)
  await expect(busy.locator('[data-row-cell="due"]')).toHaveText(/^\d\d\/\d\d$/)
  await expect(busy.locator('[data-row-cell="followup"]')).toHaveText(/^\d\d\/\d\d$/)
  await expect(widget.getByRole('button', { name: 'Task actions' })).toHaveCount(0)
})

test('hovering any row, filled or empty, moves nothing; empty placeholders appear by opacity', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 640))
  const widget = wsListWidget(page, 'tab')
  await expect(widget.locator('[data-todo-id]')).toHaveCount(TASKS.length)
  await page.mouse.move(1200, 780)
  const rest = await cellBoxes(widget)
  const bare = row(widget, 'Bare task')
  const placeholder = bare.getByRole('button', { name: 'Assign people' }).locator('[aria-hidden="true"]')
  await expect(placeholder).toHaveCSS('opacity', '0')
  for (const t of TASKS) {
    await row(widget, t.title).locator('[data-task-title]').hover()
    expect(await cellBoxes(widget), `hovering ${t.title}`).toEqual(rest)
  }
  // Over an empty cell itself too.
  await bare.getByRole('button', { name: 'Set status' }).hover()
  await expect(placeholder).toHaveCSS('opacity', '1')
  expect(await cellBoxes(widget)).toEqual(rest)
})

test('the divider: dragging sets the details width (view state, not unsaved), it survives a reload; keys step; double-click resets', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 760))
  const widget = wsListWidget(page, 'tab')
  const first = row(widget, 'Bare task')
  await expect(first).toBeVisible()
  expect(await dividerValue(widget)).toBe(300)
  expect(await laidOutDetails(first)).toBe(300)
  const titleBefore = (await box(first.locator('[data-task-title]'))).width

  // The divider sits on the gap left of the notes column and spans the rows.
  const d = await box(divider(widget))
  const notes = await box(first.locator('[data-row-cell="notes"]'))
  expect(Math.abs(d.x + d.width / 2 - (notes.x - 2.5))).toBeLessThanOrEqual(1)
  const rowsBox = await box(widget.locator('[data-task-row-grid]'))
  expect(d.height).toBeGreaterThanOrEqual(rowsBox.height - 1)

  // Drag 60px left: the details widen by 60, the title narrows by 60.
  const from = await pointIn(divider(widget))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x - 30, from.y, { steps: 3 })
  // Live while dragging.
  expect(await laidOutDetails(first)).toBe(330)
  await page.mouse.move(from.x - 60, from.y, { steps: 3 })
  await page.mouse.up()
  await expect.poll(() => dividerValue(widget)).toBe(360)
  expect(await laidOutDetails(first)).toBe(360)
  expect(Math.round((await box(first.locator('[data-task-title]'))).width)).toBe(Math.round(titleBefore - 60))
  // People and tags grew; the dates / status didn't.
  await expect.poll(() => storedTabView(page, 'tab')).toEqual({ detailsWidth: 360 })
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
  expect(Math.round((await box(first.locator('[data-row-cell="dates"]'))).width)).toBe(112)

  await page.reload()
  await expect(first).toBeVisible()
  await expect.poll(() => dividerValue(widget)).toBe(360)
  expect(await laidOutDetails(first)).toBe(360)

  // Keys: ← widens by 8, → narrows by 8, Home / End jump to min / max.
  await divider(widget).focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => dividerValue(widget)).toBe(368)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => dividerValue(widget)).toBe(352)
  await page.keyboard.press('Home')
  await expect.poll(() => dividerValue(widget)).toBe(Number(await divider(widget).getAttribute('aria-valuemin')))
  // The narrowest details: notes, the dates as icons, status.
  expect(await laidOutDetails(first)).toBe(84)
  await expect(first.locator('[data-row-cell="dates"]')).toHaveAttribute('data-dates-tier', 'icons')
  await page.keyboard.press('End')
  const max = Number(await divider(widget).getAttribute('aria-valuemax'))
  await expect.poll(() => dividerValue(widget)).toBe(max)
  // At the maximum the title keeps 80px.
  expect(Math.round((await box(first.locator('[data-task-title]'))).width)).toBe(80)
  await expect.poll(() => storedTabView(page, 'tab')).toEqual({ detailsWidth: max })

  // Double-click: back to the default, nothing stored.
  await divider(widget).dblclick()
  await expect.poll(() => dividerValue(widget)).toBe(300)
  await expect.poll(() => storedTabView(page, 'tab')).toEqual({})
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
})

test('a 280px column: the title keeps 80px and nothing passes the row edge', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0, detailsWidth: 4000 }, 280))
  const widget = wsListWidget(page, 'tab')
  await expect(widget.locator('[data-todo-id]')).toHaveCount(TASKS.length)
  for (const t of TASKS) {
    const r = row(widget, t.title)
    const rb = await box(r)
    expect((await box(r.locator('[data-task-title]'))).width, t.title).toBeGreaterThanOrEqual(79.5)
    for (const name of CELLS) {
      const c = r.locator(`[data-row-cell="${name}"]`)
      if (await c.count() === 0) continue
      const cb = await box(c)
      expect(cb.x + cb.width, `${t.title} ${name}`).toBeLessThanOrEqual(rb.x + rb.width + 0.5)
    }
  }
  // Squeezed: the tags column gave way, the dates show as icons.
  await expect(widget.locator('[data-row-cell="tags"]')).toHaveCount(0)
  await expect(widget.locator('[data-row-cell="dates"]').first()).toHaveAttribute('data-dates-tier', 'icons')
  expect(Math.round((await box(row(widget, 'Bare task').locator('[data-row-cell="due"]'))).width)).toBe(18)
  // The stored value is kept (the column may widen again).
  expect(await storedTabView(page, 'tab')).toEqual({ detailsWidth: 4000 })
})

test('Eisenhower quadrants and dashboard sections use their tab’s value', async ({ page }) => {
  await seedWorkspace(page, {
    people: PEOPLE,
    tags: TAGS,
    statuses: ['Waiting'],
    tasks: TASKS,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'a', weight: 1, cells: [{ id: 'k1', tabs: [{ id: 'eis', kind: 'eisenhower', detailsWidth: 160 }] }] },
        { id: 'b', weight: 1, cells: [{ id: 'k2', tabs: [{ id: 'dash', kind: 'dashboard', detailsWidth: 200, dashboard: { tiles: [], sections: [{ id: 'hot' }, { id: 'followup' }] } }] }] },
      ],
    }],
  })
  const eis = page.locator('[data-eisenhower="eis"]')
  await expect(eis.locator('[data-todo-id]')).toHaveCount(TASKS.length)
  for (const r of await eis.locator('[data-todo-id]').all()) expect(await laidOutDetails(r)).toBe(160)
  const dash = page.locator('[data-dash-section]')
  await expect(dash.locator('[data-todo-id]').first()).toBeVisible()
  for (const r of await dash.locator('[data-todo-id]').all()) expect(await laidOutDetails(r)).toBe(200)
  // Their rows have no ⋯ either.
  await expect(page.getByRole('button', { name: 'Task actions' })).toHaveCount(0)

  // One value for the tab: dragging one quadrant's divider moves every quadrant live, and is stored on release.
  const doQuadrant = eis.locator('[data-eis-quadrant="do"]')
  const from = await pointIn(divider(doQuadrant))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 12, from.y, { steps: 3 })
  // Mid-drag: the other quadrants' rows have moved too (148 leaves room for a people column, no tags).
  expect(await laidOutDetails(row(eis.locator('[data-eis-quadrant="drop"]'), 'Bare task'))).toBe(148)
  for (const r of await eis.locator('[data-todo-id]').all()) expect(await laidOutDetails(r)).toBe(148)
  expect(await storedTabView(page, 'eis')).toEqual({ detailsWidth: 160 })
  await page.mouse.up()
  await expect.poll(() => storedTabView(page, 'eis')).toEqual({ detailsWidth: 148 })
  for (const d of await eis.locator('[data-task-row-divider]').all()) expect(Number(await d.getAttribute('aria-valuenow'))).toBe(148)
  for (const r of await eis.locator('[data-todo-id]').all()) expect(await laidOutDetails(r)).toBe(148)
  // The dashboard keeps its own.
  for (const r of await dash.locator('[data-todo-id]').all()) expect(await laidOutDetails(r)).toBe(200)

  // The dashboard's Hot and Needs follow-up sections share theirs live too.
  const hot = page.locator('[data-dash-section="hot"]')
  const followup = page.locator('[data-dash-section="followup"]')
  const dFrom = await pointIn(divider(hot))
  await page.mouse.move(dFrom.x, dFrom.y)
  await page.mouse.down()
  await page.mouse.move(dFrom.x - 20, dFrom.y, { steps: 3 })
  expect(await laidOutDetails(row(followup, 'Book the venue'))).toBe(220)
  expect(await storedTabView(page, 'dash')).toEqual({ detailsWidth: 200 })
  await page.mouse.up()
  await expect.poll(() => storedTabView(page, 'dash')).toEqual({ detailsWidth: 220 })
  for (const r of await dash.locator('[data-todo-id]').all()) expect(await laidOutDetails(r)).toBe(220)
})

test('a click on a cell opens its picker anchored to the cell', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 760))
  const r = row(wsListWidget(page, 'tab'), 'Draft the Q4 roadmap review deck')
  await expect(r).toBeVisible()
  const panels: Array<[string, Locator]> = [
    ['markers', page.getByRole('menu', { name: 'Priority' })],
    ['notes', page.getByRole('dialog', { name: 'Progress and notes' })],
    ['people', page.locator('[data-anchored-picker]')],
    ['tags', page.locator('[data-anchored-picker]')],
    ['followup', page.getByRole('dialog', { name: 'Follow-up' })],
    ['status', page.locator('[data-anchored-picker]')],
  ]
  for (const [name, panel] of panels) {
    const cell = r.locator(`[data-row-cell="${name}"]`)
    await cell.click()
    await expect(panel, name).toBeVisible()
    const c = await box(cell)
    const p = await box(panel)
    // Below (or flipped above) the cell, overlapping it horizontally.
    expect(p.y >= c.y + c.height - 1 || p.y + p.height <= c.y + 1, `${name} vertical`).toBe(true)
    expect(p.x <= c.x + c.width + 1 && p.x + p.width >= c.x - 1, `${name} horizontal`).toBe(true)
    await page.keyboard.press('Escape')
    await expect(panel, `${name} closes`).toHaveCount(0)
  }
  // No editor opened along the way.
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toHaveCount(0)
})

test('the dates cell: the due part opens the date picker, the follow-up part the follow-up popover; each clears on its own', async ({ page }) => {
  // The native date picker can't be seen: count the calls that open it.
  await page.addInitScript(() => {
    const w = window as unknown as { __pickers: string[] }
    w.__pickers = []
    HTMLInputElement.prototype.showPicker = function (this: HTMLInputElement) { w.__pickers.push(this.type) }
  })
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 760))
  const r = row(wsListWidget(page, 'tab'), 'Book the venue')
  await expect(r).toBeVisible()
  const due = r.locator('[data-row-cell="due"]')
  const followup = r.locator('[data-row-cell="followup"]')
  // Clock, MM/DD — flag, MM/DD: the due part left of the follow-up part, side by side in one cell.
  await expect(due).toHaveText(/^\d\d\/\d\d$/)
  await expect(followup).toHaveText(/^\d\d\/\d\d$/)
  const [db, fb, cell] = [await box(due), await box(followup), await box(r.locator('[data-row-cell="dates"]'))]
  expect(db.x + db.width).toBeLessThanOrEqual(fb.x + 0.5)
  expect(db.x).toBeGreaterThanOrEqual(cell.x - 0.5)
  expect(fb.x + fb.width).toBeLessThanOrEqual(cell.x + cell.width + 0.5)

  await due.click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pickers: string[] }).__pickers)).toEqual(['date'])
  await expect(page.getByRole('dialog', { name: 'Follow-up' })).toHaveCount(0)

  await followup.click()
  const popover = page.getByRole('dialog', { name: 'Follow-up' })
  await expect(popover).toBeVisible()
  const p = await box(popover)
  expect(p.x <= fb.x + fb.width + 1 && p.x + p.width >= fb.x - 1).toBe(true)
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __pickers: string[] }).__pickers)).toEqual(['date'])

  // Each part's × shows over it on hover and clears only its own date.
  const clearFollowup = r.getByRole('button', { name: 'Clear follow-up' })
  await r.locator('[data-task-title]').hover()
  await expect(clearFollowup).toHaveCSS('opacity', '0')
  await followup.hover()
  await expect(clearFollowup).toHaveCSS('opacity', '1')
  await expect(r.getByRole('button', { name: 'Clear due date' })).toHaveCSS('opacity', '0')
  await clearFollowup.click()
  await expect(r.getByRole('button', { name: 'Set follow-up' })).toBeVisible()
  await expect(due).toHaveText(/^\d\d\/\d\d$/)
  await due.hover()
  await r.getByRole('button', { name: 'Clear due date' }).click()
  await expect(r.getByRole('button', { name: 'Set due date' })).toBeVisible()
  // Both empty: the placeholders (clock, flag) show on hover; a click on the flag opens the popover to add one.
  await r.locator('[data-task-title]').hover()
  await expect(r.getByRole('button', { name: 'Set follow-up' }).locator('[aria-hidden="true"]').first()).toHaveCSS('opacity', '1')
  await r.getByRole('button', { name: 'Set follow-up' }).click()
  await expect(popover).toBeVisible()
})

test('the marker gutter opens the markers menu; on a task urgent by its due date Urgent is unchecked and flags it', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 760, [{ title: 'Pick up prescriptions', dueInDays: 1 }]))
  const r = row(wsListWidget(page, 'tab'), 'Pick up prescriptions')
  const gutter = r.getByRole('button', { name: 'Priority: Urgent (due soon)' })
  await gutter.click()
  const menu = page.getByRole('menu', { name: 'Priority' })
  const urgent = menu.getByRole('menuitemcheckbox', { name: /^Urgent/ })
  await expect(urgent).toHaveAttribute('aria-checked', 'false')
  await expect(urgent).toContainText('By due date')
  await urgent.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(r.getByRole('button', { name: 'Priority: Urgent', exact: true })).toBeVisible()

  // Checked now; unchecking clears the flag and leaves the date.
  await r.getByRole('button', { name: 'Priority: Urgent', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: /^Urgent/ })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemcheckbox', { name: /^Urgent/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(r.getByRole('button', { name: 'Priority: Urgent (due soon)' })).toBeVisible()

  await r.getByRole('button', { name: 'Priority: Urgent (due soon)' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Focus' }).click()
  await expect(r.getByRole('button', { name: 'Priority: Focus, Urgent (due soon)' })).toBeVisible()
})

test('a drag can start on a cell; a click there without moving opens its picker; a double-click opens it once', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'eisenhower' }, 760, [{ title: 'Plain task' }, { title: 'Keep me', important: true }]))
  const eis = page.locator('[data-eisenhower="tab"]')
  const plain = row(eis, 'Plain task')
  await expect(eis.locator('[data-eis-quadrant="drop"]').locator('[data-task-title="Plain task"]')).toBeVisible()
  // Drag from the (empty) people cell into Schedule: the task becomes important.
  await drag(page, await pointIn(plain.getByRole('button', { name: 'Assign people' })), await pointIn(eis.locator('[data-eis-quadrant="schedule"]'), 0.5, 0.7))
  await expect(eis.locator('[data-eis-quadrant="schedule"]').locator('[data-task-title="Plain task"]')).toBeVisible()
  await expect(page.locator('[data-anchored-picker]')).toHaveCount(0)

  // A click without movement opens the cell's picker.
  await row(eis, 'Plain task').getByRole('button', { name: 'Assign people' }).click()
  await expect(page.locator('[data-anchored-picker]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-anchored-picker]')).toHaveCount(0)

  // A double-click on a cell: its picker opens (once) and the editor doesn't.
  await row(eis, 'Plain task').getByRole('button', { name: 'Set status' }).dblclick()
  await expect(page.locator('[data-anchored-picker]')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  // On the title it opens the editor.
  await row(eis, 'Plain task').locator('[data-task-title]').dblclick()
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
})

/** The colour of the pixels in the middle of `el`'s bottom and top edges (inside it), as rendered. */
async function edgeColours(page: Page, el: Locator): Promise<{ bottom: number[]; top: number[] }> {
  const b = await box(el)
  const shot = await page.screenshot({ clip: { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.ceil(b.height) } })
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const x = Math.floor(bitmap.width / 2)
    const px = (y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3))
    // The brightest of the two edge rows (the ring may straddle a pixel boundary).
    const lum = (c: number[]) => c.reduce((s, v) => s + v, 0)
    const pick = (a: number[], c: number[]) => (lum(a) >= lum(c) ? a : c)
    return { bottom: pick(px(bitmap.height - 1), px(bitmap.height - 2)), top: pick(px(0), px(1)) }
  }, shot.toString('base64'))
}

test('the selection ring is drawn whole — the bottom edge too, with or without hover', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 760))
  const widget = wsListWidget(page, 'tab')
  const wrapper = widget.locator('[data-row-key]').filter({ has: page.locator('[data-task-title="Book the venue"]') })
  await wrapper.locator('[data-task-title]').click()
  await expect(wrapper).toHaveAttribute('data-cursor', 'true')
  const accent = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.color = 'var(--color-accent)'
    document.body.appendChild(probe)
    const rgb = getComputedStyle(probe).color.match(/\d+/g)!.slice(0, 3).map(Number)
    probe.remove()
    return rgb
  })
  const near = (c: number[]) => c.every((v, i) => Math.abs(v - accent[i]!) <= 70)
  await page.mouse.move(1200, 780)
  let edges = await edgeColours(page, wrapper)
  expect(near(edges.bottom), `bottom ${edges.bottom} vs accent ${accent}`).toBe(true)
  expect(near(edges.top), `top ${edges.top} vs accent ${accent}`).toBe(true)
  await wrapper.locator('[data-task-title]').hover()
  edges = await edgeColours(page, wrapper)
  expect(near(edges.bottom), `hovered bottom ${edges.bottom} vs accent ${accent}`).toBe(true)
})
