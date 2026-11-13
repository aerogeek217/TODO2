import type { DataRow } from '../../../data/schema-upgrades'

/**
 * REFERENCE COPY — `src/data/upgrades/layout-tabs.ts` as it was before cr34
 * (commit f442d1fb), kept word for word but for the import path above. The
 * cr34 fix made its line merge linear and its close one pass over the cells
 * (it took seconds on a crafted file); `upgrade-work-bounds.test` runs both
 * on thousands of random layouts and requires the same output, so the
 * upgrade goes on producing what it produced. Never edit this copy.
 *
 * The one walk over a stored layout's tabs that the schema steps share (v78's
 * widget set, v79's final shapes): each tab through a step that keeps it,
 * rewrites it or drops it, then the cells the drops leave without tabs close
 * as Close cell does.
 *
 * - A cell whose active tab went shows the tab before it (else the one
 *   after), as closing a tab does.
 * - A cell the drops leave **without tabs closes**: the neighbour sharing
 *   its whole edge — looked for left, above, right, below — takes its
 *   space; with none, the neighbours along a side that together cover that
 *   whole edge (none sticking out past either end; the sides in the same
 *   order) all grow across it; with none of those either (a pinwheel's
 *   centre), it stays as an empty cell. A cell that was empty before is
 *   left as it was. The cells close in reading order, each against the
 *   table as the ones before left it. Then every inner grid line no cell's
 *   edge lies on goes (its two tracks merge: the first's id, the sizes
 *   added — two fixed tracks' px, else the weights —, collapsed only when
 *   both were), and the cells are put in reading order (by their top track,
 *   then their left).
 *
 * Holds its own copy of everything it reads — the close rule and the line
 * merge — so the steps go on meaning what they meant whatever later builds
 * do (moved here unchanged from `upgrades/v78/widget-set`). Defensive: a cell
 * that isn't an object or has no list of tabs, a tab that isn't an object,
 * is left as it is (for the layout repair); when the table doesn't read (no
 * track lists, a cell without a whole-number area), the tabs are still
 * rewritten and dropped but no cell closes — the repair closes what's left
 * empty. A layout no step changes is returned as it is (idempotent).
 */

export type Obj = Record<string, unknown>

export function isRecord(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** What a step does to one tab: the same object (kept as it is), a new one (rewritten), or `null` (it goes). */
export type TabStep = (tab: Obj) => Obj | null

/** A cell's area in tracks, as `[c0, c1, r0, r1)`. */
interface Rect {
  c0: number
  c1: number
  r0: number
  r1: number
}

type Axis = 'columns' | 'rows'

/** The sides a closed cell's taker is looked for on, in order. */
const SIDES = ['left', 'top', 'right', 'bottom'] as const
type Side = (typeof SIDES)[number]

function isTrackIndex(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min
}

/** A cell's stored area as a rectangle, when it reads as one. */
function rectOf(cell: Obj): Rect | null {
  const a = cell.area
  if (!isRecord(a) || !isTrackIndex(a.col, 0) || !isTrackIndex(a.row, 0) || !isTrackIndex(a.colSpan, 1) || !isTrackIndex(a.rowSpan, 1)) return null
  return { c0: a.col, c1: a.col + a.colSpan, r0: a.row, r1: a.row + a.rowSpan }
}

function areaOf(r: Rect): Obj {
  return { col: r.c0, row: r.r0, colSpan: r.c1 - r.c0, rowSpan: r.r1 - r.r0 }
}

/** `[start, end)` of `r` along `axis`. */
function spanOf(r: Rect, axis: Axis): [number, number] {
  return axis === 'columns' ? [r.c0, r.c1] : [r.r0, r.r1]
}

/** `tabs` through `step`, and the active tab that follows; `null` when nothing changes. */
function convertTabs(cell: Obj, step: TabStep): { tabs: unknown[]; activeTabId: unknown } | null {
  const tabs = cell.tabs as unknown[]
  let changed = false
  const kept: unknown[] = []
  for (const tab of tabs) {
    if (!isRecord(tab)) {
      kept.push(tab)
      continue
    }
    const next = step(tab)
    if (next !== tab) changed = true
    if (next) kept.push(next)
  }
  if (!changed) return null
  let activeTabId = cell.activeTabId
  const idOf = (t: unknown) => (isRecord(t) ? t.id : undefined)
  if (activeTabId !== undefined && !kept.some((t) => idOf(t) === activeTabId)) {
    // The active tab went: the one before it, else the one after (as closing a tab).
    const at = tabs.findIndex((t) => idOf(t) === activeTabId)
    const keptIds = new Set(kept.map(idOf))
    const before = tabs.slice(0, Math.max(0, at)).reverse().find((t) => keptIds.has(idOf(t)))
    const after = tabs.slice(at + 1).find((t) => keptIds.has(idOf(t)))
    activeTabId = idOf(before ?? after)
  }
  return { tabs: kept, activeTabId }
}

/** `cell` with `tabs` and `activeTabId` (absent when `undefined`). */
function withTabs(cell: Obj, tabs: unknown[], activeTabId: unknown): Obj {
  const { activeTabId: _a, ...rest } = cell
  void _a
  return activeTabId === undefined ? { ...rest, tabs } : { ...rest, tabs, activeTabId }
}

/** A table whose every cell reads: the cells by index, with their rectangles. */
interface Table {
  columns: unknown[]
  rows: unknown[]
  cells: Obj[]
  rects: Rect[]
}

function readTable(row: Obj, cells: unknown[]): Table | null {
  const grid = row.grid
  if (!isRecord(grid) || !Array.isArray(grid.columns) || !Array.isArray(grid.rows)) return null
  const objs: Obj[] = []
  const rects: Rect[] = []
  for (const c of cells) {
    const r = isRecord(c) ? rectOf(c) : null
    if (!isRecord(c) || !r) return null
    objs.push(c)
    rects.push(r)
  }
  return { columns: grid.columns, rows: grid.rows, cells: objs, rects }
}

/** The index of the cell across `side` of cell `i` sharing the whole of that edge, if any. */
function wholeEdgeTaker(t: Table, i: number, side: Side): number {
  const r = t.rects[i]
  if (!r) return -1
  return t.rects.findIndex((q, j) => {
    if (j === i) return false
    switch (side) {
      case 'left': return q.c1 === r.c0 && q.r0 === r.r0 && q.r1 === r.r1
      case 'right': return q.c0 === r.c1 && q.r0 === r.r0 && q.r1 === r.r1
      case 'top': return q.r1 === r.r0 && q.c0 === r.c0 && q.c1 === r.c1
      case 'bottom': return q.r0 === r.r1 && q.c0 === r.c0 && q.c1 === r.c1
    }
    return false
  })
}

/**
 * The indices of the cells along `side` of cell `i` that together cover
 * that whole edge — every cell touching the edge lies within it, the first
 * starting where it starts and the last ending where it ends (the cells
 * tile, so they meet end to end) —, or `null` when they don't.
 */
function sideTakers(t: Table, i: number, side: Side): number[] | null {
  const r = t.rects[i]
  if (!r) return null
  const across: Axis = side === 'left' || side === 'right' ? 'rows' : 'columns'
  const [start, end] = spanOf(r, across)
  const along: Array<{ j: number; s: number; e: number }> = []
  t.rects.forEach((q, j) => {
    if (j === i) return
    const touches = side === 'left' ? q.c1 === r.c0
      : side === 'right' ? q.c0 === r.c1
        : side === 'top' ? q.r1 === r.r0
          : q.r0 === r.r1
    const [s, e] = spanOf(q, across)
    if (touches && s < end && e > start) along.push({ j, s, e })
  })
  if (along.length === 0 || along.some((a) => a.s < start || a.e > end)) return null
  along.sort((a, b) => a.s - b.s)
  if (along[0]?.s !== start || along.at(-1)?.e !== end) return null
  return along.map((a) => a.j)
}

/** `q` grown across `r`, from `side` of `r`: its edge on `r` moved to `r`'s far edge. */
function grownAcross(q: Rect, r: Rect, side: Side): Rect {
  switch (side) {
    case 'left': return { ...q, c1: r.c1 }
    case 'right': return { ...q, c0: r.c0 }
    case 'top': return { ...q, r1: r.r1 }
    case 'bottom': return { ...q, r0: r.r0 }
  }
}

/**
 * Closes cell `i` (no tabs): a whole-edge neighbour takes its rectangle;
 * with none, the neighbours along a side that together cover that edge
 * (`sideTakers`, the sides in the same order) all grow across it; `false`
 * with neither (it stays empty).
 */
function closeInto(t: Table, i: number): boolean {
  const r = t.rects[i]
  if (!r) return false
  const drop = () => {
    t.rects.splice(i, 1)
    t.cells.splice(i, 1)
  }
  for (const side of SIDES) {
    const j = wholeEdgeTaker(t, i, side)
    const q = t.rects[j]
    if (j < 0 || !q) continue
    t.rects[j] = { c0: Math.min(q.c0, r.c0), c1: Math.max(q.c1, r.c1), r0: Math.min(q.r0, r.r0), r1: Math.max(q.r1, r.r1) }
    drop()
    return true
  }
  for (const side of SIDES) {
    const takers = sideTakers(t, i, side)
    if (!takers) continue
    for (const j of takers) {
      const q = t.rects[j]
      if (q) t.rects[j] = grownAcross(q, r, side)
    }
    drop()
    return true
  }
  return false
}

/** Two tracks as one, when the line between them goes. */
function mergedTrack(a: unknown, b: unknown): unknown {
  if (!isRecord(a) || !isRecord(b)) return a
  const merged: Obj = { id: a.id }
  const px = (t: Obj) => (typeof t.px === 'number' ? t.px : null)
  const weight = (t: Obj) => (px(t) == null && typeof t.weight === 'number' ? t.weight : 0)
  const pa = px(a)
  const pb = px(b)
  if (pa != null && pb != null) merged.px = pa + pb
  else merged.weight = weight(a) + weight(b)
  if (a.collapsed === true && b.collapsed === true) merged.collapsed = true
  return merged
}

/** Drops every inner line of `axis` no cell's edge lies on. */
function mergeLines(t: Table, axis: Axis): void {
  let tracks = axis === 'columns' ? t.columns : t.rows
  let line = 1
  while (line < tracks.length) {
    if (t.rects.some((r) => spanOf(r, axis).includes(line))) {
      line++
      continue
    }
    tracks = [...tracks.slice(0, line - 1), mergedTrack(tracks[line - 1], tracks[line]), ...tracks.slice(line + 1)]
    t.rects = t.rects.map((r) => {
      const [s, e] = spanOf(r, axis)
      const s2 = s >= line ? s - 1 : s
      const e2 = e >= line ? e - 1 : e
      return axis === 'columns' ? { ...r, c0: s2, c1: e2 } : { ...r, r0: s2, r1: e2 }
    })
  }
  if (axis === 'columns') t.columns = tracks
  else t.rows = tracks
}

/** A layout row (or a kept draft's body) with its tabs through `step` and the cells it empties closed; the row itself when nothing changes. */
export function layoutTabsOf(row: DataRow, step: TabStep): DataRow {
  if (!isRecord(row) || !Array.isArray(row.cells)) return row
  const before = row.cells as unknown[]
  let changed = false
  const emptied = new Set<Obj>()
  const cells = before.map((c) => {
    if (!isRecord(c) || !Array.isArray(c.tabs)) return c
    const next = convertTabs(c, step)
    if (!next) return c
    changed = true
    const cell = withTabs(c, next.tabs, next.activeTabId)
    if (next.tabs.length === 0 && (c.tabs as unknown[]).length > 0) emptied.add(cell)
    return cell
  })
  if (!changed) return row
  const table = emptied.size > 0 ? readTable(row, cells) : null
  if (!table) return { ...row, cells }

  // Close the emptied cells in reading order, each against the table as the ones before left it.
  const order = table.cells
    .map((cell, i) => ({ cell, r: table.rects[i] as Rect }))
    .filter((x) => emptied.has(x.cell))
    .sort((a, b) => a.r.r0 - b.r.r0 || a.r.c0 - b.r.c0)
    .map((x) => x.cell)
  let closed = false
  for (const cell of order) {
    const i = table.cells.indexOf(cell)
    if (i >= 0 && closeInto(table, i)) closed = true
  }
  if (!closed) return { ...row, cells }
  mergeLines(table, 'columns')
  mergeLines(table, 'rows')
  const placed = table.cells
    .map((cell, i) => ({ cell, r: table.rects[i] as Rect }))
    .sort((a, b) => a.r.r0 - b.r.r0 || a.r.c0 - b.r.c0)
    .map(({ cell, r }) => ({ ...cell, area: areaOf(r) }))
  const grid = row.grid as Obj
  return { ...row, grid: { ...grid, columns: table.columns, rows: table.rows }, cells: placed }
}
