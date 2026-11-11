import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { box, pointIn, type Box } from './fixtures/geometry'
import { defaultDetailsWidth, taskRowColumns, TASK_ROW } from '../src/utils/task-row-columns'
import { drag, seedWorkspace, wsListWidget, type WorkspaceSeed, type WsTabSeed, wsRow, expectLayoutStored } from './fixtures/workspace'

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
        { id: 'w', weight: width, rows: [wsRow({ id: 'cell', tabs: [{ id: 'tab', ...tab }] })] },
        { id: 'rest', weight: 1280 - width, rows: [wsRow({ id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] })] },
      ],
    }],
  }
}

/** A row date's text (D25 D1): `Today`, a weekday, or `11/20` (no year). */
const ROW_DATE = /^(Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d\d\/\d\d|\d\d\/\d\d\/\d\d)$/

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
    // (The date parts' × overlays are not columns, nor the subtasks count / add mark, which sits inside the title after its text.)
    for (const el of Array.from(row.querySelectorAll('[data-row-cell]:not([data-row-cell$="-clear"]):not([data-row-cell="subtasks"])'))) add(el.getAttribute('data-row-cell')!, el)
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
  const layouts = await readStore<{ cells: Array<{ tabs: Array<{ id: string; viewState?: Record<string, unknown> }> }> }>(page, 'layouts')
  for (const l of layouts) for (const k of l.cells) for (const t of k.tabs) if (t.id === tabId) return t.viewState
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

test('status is the last column, flush with the row’s right padding; the default split (45 % of the row, at most 300) keeps people and tags their room beside both dates', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 640))
  const widget = wsListWidget(page, 'tab')
  await expect(widget.locator('[data-todo-id]')).toHaveCount(TASKS.length)
  for (const r of await widget.locator('[data-todo-id]').all()) {
    const rb = await box(r)
    const status = await box(r.locator('[data-row-cell="status"]'))
    expect(Math.round(rb.x + rb.width - 8 - (status.x + status.width))).toBe(0)
    // Nothing stored: the details take 45 % of the row's inner width, at most 300 (defaultDetailsWidth) — the title the larger part.
    expect(await laidOutDetails(r)).toBe(defaultDetailsWidth(rb.width - TASK_ROW.padLeft - TASK_ROW.padRight))
    expect(await laidOutDetails(r)).toBeLessThan(rb.width / 2)
  }
  const busy = row(widget, 'Draft the Q4 roadmap review deck')
  // That split leaves people and tags their room beside both dates (people 40 % of what is left, tags the rest).
  const cols = taskRowColumns((await box(busy)).width)
  expect(cols.datesTier).toBe('both')
  expect(Math.round((await box(busy.locator('[data-row-cell="people"]'))).width)).toBe(cols.people)
  expect(Math.round((await box(busy.locator('[data-row-cell="tags"]'))).width)).toBe(cols.tags)
  expect(Math.round((await box(busy.locator('[data-row-cell="dates"]'))).width)).toBe(92)
  await expect(busy.locator('[data-row-cell="due"]')).toHaveText(ROW_DATE)
  await expect(busy.locator('[data-row-cell="followup"]')).toHaveText(ROW_DATE)
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
  await expectLayoutStored(page)
  expect(Math.round((await box(first.locator('[data-row-cell="dates"]'))).width)).toBe(92)

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
  // At the maximum the title keeps its minimum (140px: titles first).
  expect(Math.round((await box(first.locator('[data-task-title]'))).width)).toBe(TASK_ROW.titleMin)
  await expect.poll(() => storedTabView(page, 'tab')).toEqual({ detailsWidth: max })

  // Double-click: back to the default, nothing stored.
  await divider(widget).dblclick()
  await expect.poll(() => dividerValue(widget)).toBe(300)
  await expect.poll(() => storedTabView(page, 'tab')).toEqual({})
  await expectLayoutStored(page)
})

test('a 280px column: a stored wide split gives way, the title keeping all the narrowest details leave; nothing passes the row edge', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0, detailsWidth: 4000 }, 280))
  const widget = wsListWidget(page, 'tab')
  await expect(widget.locator('[data-todo-id]')).toHaveCount(TASKS.length)
  for (const t of TASKS) {
    const r = row(widget, t.title)
    const rb = await box(r)
    // Under the title's 140px minimum here: the details are at their narrowest (84), the title has the rest.
    const narrowest = taskRowColumns(rb.width, 0).laidOut
    expect((await box(r.locator('[data-task-title]'))).width, t.title).toBeGreaterThanOrEqual(rb.width - TASK_ROW.padLeft - TASK_ROW.padRight - TASK_ROW.gutter - TASK_ROW.checkbox - 3 * TASK_ROW.gap - narrowest - 0.5)
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

test('a click on a cell opens its picker anchored to the cell', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 760))
  const r = row(wsListWidget(page, 'tab'), 'Draft the Q4 roadmap review deck')
  await expect(r).toBeVisible()
  const panels: Array<[string, Locator]> = [
    ['markers', page.getByRole('menu', { name: 'Priority' })],
    ['notes', page.getByRole('dialog', { name: 'Status and notes' })],
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
  // The due date's text — the follow-up's: the due part left of the follow-up part, side by side in one cell.
  await expect(due).toHaveText(ROW_DATE)
  await expect(followup).toHaveText(ROW_DATE)
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
  await expect(due).toHaveText(ROW_DATE)
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
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }, 760, [{ title: 'Plain task' }, { title: 'Keep me', important: true }]))
  const list = wsListWidget(page, 'tab')
  const plain = row(list, 'Plain task')
  await expect(list.locator('[data-task-title]')).toHaveText(['Plain task', 'Keep me'])
  // Drag from the (empty) people cell below the other row: the list's manual order changes.
  await drag(page, await pointIn(plain.getByRole('button', { name: 'Assign people' })), await pointIn(row(list, 'Keep me'), 0.3, 0.9))
  await expect(list.locator('[data-task-title]')).toHaveText(['Keep me', 'Plain task'])
  await expect(page.locator('[data-anchored-picker]')).toHaveCount(0)

  // A click without movement opens the cell's picker.
  await row(list, 'Plain task').getByRole('button', { name: 'Assign people' }).click()
  await expect(page.locator('[data-anchored-picker]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-anchored-picker]')).toHaveCount(0)

  // A double-click on a cell: its picker opens (once) and the editor doesn't.
  await row(list, 'Plain task').getByRole('button', { name: 'Set status' }).dblclick()
  await expect(page.locator('[data-anchored-picker]')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  // On the title's text it opens the editor (its middle may be past the text, on the hover-revealed Add subtasks mark).
  await row(list, 'Plain task').locator('[data-task-title]').dblclick({ position: { x: 8, y: 10 } })
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
