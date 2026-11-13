import type { CellArea, GridAxis, GridTrack, LayoutBody, LayoutCell } from '../models/workspace-layout'

/**
 * The layout's table (D26): its tracks, its lines and where its cells are.
 * Pure reads plus the two checks every layout op ends with —
 * `normalizeGrid` (merges a line no cell's edge lies on, expands a collapsed
 * row nothing can expand, keeps the cells in reading order) and
 * `validateTiling` (the cells cover the grid exactly).
 *
 * Coordinates are track indices. A cell covers the columns `col …
 * col + colSpan - 1` and the rows `row … row + rowSpan - 1`; as a
 * {@link CellRect} its ends are exclusive — the lines it lies between. Line
 * `k` of an axis is the line before track `k` (line 0 the layout's first
 * edge, line `n` its last).
 */

/** A cell's rectangle as the lines it lies between (ends exclusive). */
export interface CellRect {
  c0: number
  r0: number
  c1: number
  r1: number
}

/** A side of a cell (or of the layout). */
export type Side = 'left' | 'top' | 'right' | 'bottom'

/** The sides in the order a closing cell offers its space: left, above, right, below. */
export const SIDES: readonly Side[] = ['left', 'top', 'right', 'bottom']

/** The axis whose tracks a side's line separates: left / right lines are between columns. */
export function sideAxis(side: Side): GridAxis {
  return side === 'left' || side === 'right' ? 'columns' : 'rows'
}

/** The other axis. */
export function crossAxis(axis: GridAxis): GridAxis {
  return axis === 'columns' ? 'rows' : 'columns'
}

export function rectOf(area: CellArea): CellRect {
  return { c0: area.col, r0: area.row, c1: area.col + area.colSpan, r1: area.row + area.rowSpan }
}

export function areaOf(rect: CellRect): CellArea {
  return { col: rect.c0, row: rect.r0, colSpan: rect.c1 - rect.c0, rowSpan: rect.r1 - rect.r0 }
}

/** A cell's start and end (exclusive) along `axis`. */
export function spanOf(area: CellArea, axis: GridAxis): [start: number, end: number] {
  return axis === 'columns' ? [area.col, area.col + area.colSpan] : [area.row, area.row + area.rowSpan]
}

/** `area` with its extent along `axis` set to `start … end` (exclusive). */
export function withSpan(area: CellArea, axis: GridAxis, start: number, end: number): CellArea {
  return axis === 'columns'
    ? { ...area, col: start, colSpan: end - start }
    : { ...area, row: start, rowSpan: end - start }
}

export function sameArea(a: CellArea, b: CellArea): boolean {
  return a.col === b.col && a.row === b.row && a.colSpan === b.colSpan && a.rowSpan === b.rowSpan
}

/** The cell with id `cellId`, if any. */
export function cellById(body: LayoutBody, cellId: string): LayoutCell | undefined {
  return body.cells.find((c) => c.id === cellId)
}

/** The cell covering column track `col` and row track `row`, if any. */
export function cellAtTrack(body: LayoutBody, col: number, row: number): LayoutCell | undefined {
  return body.cells.find((c) => {
    const r = rectOf(c.area)
    return col >= r.c0 && col < r.c1 && row >= r.r0 && row < r.r1
  })
}

/** Whether `a` comes before `b` in reading order: by its top track, then its left. */
function readingCompare(a: LayoutCell, b: LayoutCell): number {
  return a.area.row - b.area.row || a.area.col - b.area.col
}

/** Every cell in reading order: by its top track, then its left (the phone's order). */
export function readingOrder(body: LayoutBody): LayoutCell[] {
  return [...body.cells].sort(readingCompare)
}

/** Whether `[a0, a1)` and `[b0, b1)` overlap. */
function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1
}

/**
 * The cells across `side` of cell `cellId`: those whose opposite edge lies
 * on that side's line and which share some of its length, in order along
 * the edge.
 */
export function neighbours(body: LayoutBody, cellId: string, side: Side): LayoutCell[] {
  const cell = cellById(body, cellId)
  if (!cell) return []
  const r = rectOf(cell.area)
  return body.cells
    .filter((o) => {
      if (o.id === cellId) return false
      const q = rectOf(o.area)
      switch (side) {
        case 'left': return q.c1 === r.c0 && overlaps(q.r0, q.r1, r.r0, r.r1)
        case 'right': return q.c0 === r.c1 && overlaps(q.r0, q.r1, r.r0, r.r1)
        case 'top': return q.r1 === r.r0 && overlaps(q.c0, q.c1, r.c0, r.c1)
        case 'bottom': return q.r0 === r.r1 && overlaps(q.c0, q.c1, r.c0, r.c1)
      }
      return false
    })
    .sort(side === 'left' || side === 'right' ? (a, b) => a.area.row - b.area.row : (a, b) => a.area.col - b.area.col)
}

/** The neighbour across `side` sharing the whole of that edge (the same extent along it), if any. */
export function wholeEdgeNeighbour(body: LayoutBody, cellId: string, side: Side): LayoutCell | undefined {
  const cell = cellById(body, cellId)
  if (!cell) return undefined
  const r = rectOf(cell.area)
  return neighbours(body, cellId, side).find((o) => {
    const q = rectOf(o.area)
    return side === 'left' || side === 'right' ? q.r0 === r.r0 && q.r1 === r.r1 : q.c0 === r.c0 && q.c1 === r.c1
  })
}

/** The rectangle two cells make together, when they do (side by side over the same rows, or stacked over the same columns); else `null`. */
export function unionArea(a: CellArea, b: CellArea): CellArea | null {
  const p = rectOf(a)
  const q = rectOf(b)
  if (p.r0 === q.r0 && p.r1 === q.r1 && (p.c1 === q.c0 || q.c1 === p.c0)) {
    return areaOf({ c0: Math.min(p.c0, q.c0), c1: Math.max(p.c1, q.c1), r0: p.r0, r1: p.r1 })
  }
  if (p.c0 === q.c0 && p.c1 === q.c1 && (p.r1 === q.r0 || q.r1 === p.r0)) {
    return areaOf({ r0: Math.min(p.r0, q.r0), r1: Math.max(p.r1, q.r1), c0: p.c0, c1: p.c1 })
  }
  return null
}

/** Whether cells `aId` and `bId` merge into a rectangle (`unionArea`). */
export function canMerge(body: LayoutBody, aId: string, bId: string): boolean {
  const a = cellById(body, aId)
  const b = cellById(body, bId)
  return a != null && b != null && a !== b && unionArea(a.area, b.area) != null
}

/** The neighbour across `side` that cell `cellId` merges with into a rectangle (Merge with ▸ Right / Below), if any. */
export function mergeNeighbour(body: LayoutBody, cellId: string, side: Side): LayoutCell | undefined {
  return wholeEdgeNeighbour(body, cellId, side)
}

/** Whether line `line` of `axis` (an inner one) is some cell's edge. */
export function isCellEdge(body: LayoutBody, axis: GridAxis, line: number): boolean {
  return body.cells.some((c) => {
    const [start, end] = spanOf(c.area, axis)
    return start === line || end === line
  })
}

/** The track a run of two tracks makes when the line between them goes: the first's id, the sizes added, collapsed only when both were. */
export function mergeTracks(a: GridTrack, b: GridTrack): GridTrack {
  const merged: GridTrack = { id: a.id }
  if (a.px != null && b.px != null) merged.px = a.px + b.px
  else merged.weight = (a.px == null ? (a.weight ?? 0) : 0) + (b.px == null ? (b.weight ?? 0) : 0)
  if (a.collapsed === true && b.collapsed === true) merged.collapsed = true
  return merged
}

/** `body` with line `line` of `axis` gone: its two tracks merged, every cell's coordinates past it shifted back. */
function dropLine<B extends LayoutBody>(body: B, axis: GridAxis, line: number): B {
  const tracks = body.grid[axis]
  const a = tracks[line - 1]
  const b = tracks[line]
  if (!a || !b) return body
  const merged = [...tracks.slice(0, line - 1), mergeTracks(a, b), ...tracks.slice(line + 1)]
  const cells = body.cells.map((c) => {
    const [start, end] = spanOf(c.area, axis)
    const s = start >= line ? start - 1 : start
    const e = end >= line ? end - 1 : end
    return s === start && e === end ? c : { ...c, area: withSpan(c.area, axis, s, e) }
  })
  return { ...body, grid: { ...body.grid, [axis]: merged }, cells }
}

/**
 * The collapsed row tracks (their indices) that nothing can expand: no
 * filled cell lies wholly in collapsed tracks over them. Only such a cell
 * draws folded and offers Expand row — a cell spanning on into an expanded
 * row doesn't, and an empty cell has no Expand at all — so a collapsed track
 * without one is a header's height of table with no way back (and no
 * divider on either side of it).
 */
export function orphanCollapsedRows(body: LayoutBody): number[] {
  const rows = body.grid.rows
  if (!rows.some((t) => t.collapsed === true)) return []
  const held = new Set<number>()
  for (const c of body.cells) {
    if (c.tabs.length === 0) continue
    const [start, end] = spanOf(c.area, 'rows')
    let folded = end > start
    for (let r = start; r < end && folded; r++) folded = rows[r]?.collapsed === true
    if (folded) for (let r = start; r < end; r++) held.add(r)
  }
  return rows.flatMap((t, r) => (t.collapsed === true && !held.has(r) ? [r] : []))
}

/**
 * `body` with every collapsed row track nothing can expand
 * (`orphanCollapsedRows`) expanded: a collapsed row expands by itself once
 * no filled cell lies only in it (its cell closed, moved away, or grown on
 * into an expanded row). The same object when there is none.
 */
export function expandOrphanRows<B extends LayoutBody>(body: B): B {
  const orphans = new Set(orphanCollapsedRows(body))
  if (orphans.size === 0) return body
  const rows = body.grid.rows.map((t, r) => {
    if (!orphans.has(r)) return t
    const { collapsed: _c, ...rest } = t
    void _c
    return rest
  })
  return { ...body, grid: { ...body.grid, rows } }
}

/**
 * The body in its normal form: every inner line some cell's edge (a line
 * that is none goes — its two tracks merge, `mergeTracks`), no collapsed row
 * that nothing can expand (`expandOrphanRows`), no tracks when there are no
 * cells, and the cells in reading order. Assumes a valid tiling
 * (`validateTiling`). The same object when it already is.
 */
export function normalizeGrid<B extends LayoutBody>(body: B): B {
  if (body.cells.length === 0) {
    if (body.grid.columns.length === 0 && body.grid.rows.length === 0) return body
    return { ...body, grid: { columns: [], rows: [] } }
  }
  let next = body
  for (const axis of ['columns', 'rows'] as const) {
    let line = 1
    while (line < next.grid[axis].length) {
      if (isCellEdge(next, axis, line)) line++
      else next = dropLine(next, axis, line)
    }
  }
  next = expandOrphanRows(next)
  const ordered = next.cells.every((c, i) => i === 0 || readingCompare(next.cells[i - 1] as LayoutCell, c) < 0)
  if (!ordered) next = { ...next, cells: readingOrder(next) }
  return next
}

/** Whether `body` is in normal form (`normalizeGrid` leaves it as it is). */
export function isNormalized(body: LayoutBody): boolean {
  return normalizeGrid(body) === body
}

/**
 * `true` when the cells tile the grid exactly — each inside it with spans of
 * at least one track, no two overlapping, every track covered (no cells
 * means no tracks) —, else what is wrong.
 */
export function validateTiling(body: LayoutBody): true | string {
  const cols = body.grid.columns.length
  const rows = body.grid.rows.length
  if (body.cells.length === 0) return cols === 0 && rows === 0 ? true : 'tracks without cells'
  if (cols === 0 || rows === 0) return 'cells without tracks'
  let covered = 0
  const rects: CellRect[] = []
  for (const c of body.cells) {
    const { col, row, colSpan, rowSpan } = c.area
    if (![col, row, colSpan, rowSpan].every(Number.isInteger)) return `cell ${c.id}: not whole tracks`
    if (col < 0 || row < 0 || colSpan < 1 || rowSpan < 1 || col + colSpan > cols || row + rowSpan > rows) return `cell ${c.id}: outside the grid`
    const r = rectOf(c.area)
    for (const q of rects) {
      if (overlaps(r.c0, r.c1, q.c0, q.c1) && overlaps(r.r0, r.r1, q.r0, q.r1)) return `cell ${c.id}: overlaps another`
    }
    rects.push(r)
    covered += colSpan * rowSpan
  }
  return covered === cols * rows ? true : 'gaps in the grid'
}

// ── Edges ───────────────────────────────────────────────────────────────────

/**
 * A stretch of a grid line: line `line` of `axis` (`columns`: an upright
 * line between column tracks `line - 1` and `line`; `rows`: a level one),
 * over the tracks `from … to - 1` of the other axis. A divider is one.
 */
export interface EdgeStretch {
  axis: GridAxis
  line: number
  from: number
  to: number
}

/** Whether line `line` of `axis` is an edge at track `t` of the other axis: the cell before it there ends on it. */
function bordersAt(body: LayoutBody, axis: GridAxis, line: number, t: number): boolean {
  const before = axis === 'columns' ? cellAtTrack(body, line - 1, t) : cellAtTrack(body, t, line - 1)
  return before != null && spanOf(before.area, axis)[1] === line
}

/**
 * Whether line `line` of `axis` meets a "+" at line `at` of the other axis:
 * that perpendicular line is a cell edge on both sides of this one (at
 * track `line - 1` and track `line`). At a "T" — the perpendicular line on
 * one side only — it doesn't.
 */
function crossesAt(body: LayoutBody, axis: GridAxis, line: number, at: number): boolean {
  const cross = crossAxis(axis)
  return bordersAt(body, cross, at, line - 1) && bordersAt(body, cross, at, line)
}

/**
 * `[from, to)` grown along line `line` of `axis` while the line stays an
 * edge, up to a "+" crossing (`crossesAt`): each piece between crossings is
 * a divider of its own. At a "T" it runs on — a cell spanning past that
 * point keeps a straight edge.
 */
function extendStretch(body: LayoutBody, axis: GridAxis, line: number, from: number, to: number): EdgeStretch {
  const count = body.grid[crossAxis(axis)].length
  let f = from
  let t = to
  while (f > 0 && bordersAt(body, axis, line, f - 1) && !crossesAt(body, axis, line, f)) f--
  while (t < count && bordersAt(body, axis, line, t) && !crossesAt(body, axis, line, t)) t++
  return { axis, line, from: f, to: t }
}

/**
 * A "+" crossing of two inner lines: column line `col` (an upright line)
 * and row line `row` (a level one), each a cell edge on both sides of the
 * other — four cells meet there.
 */
export interface LineCrossing {
  col: number
  row: number
}

/** Every "+" crossing of the table's inner lines, in reading order (by row line, then column line). */
export function lineCrossings(body: LayoutBody): LineCrossing[] {
  const out: LineCrossing[] = []
  for (let row = 1; row < body.grid.rows.length; row++) {
    for (let col = 1; col < body.grid.columns.length; col++) {
      const upright = bordersAt(body, 'columns', col, row - 1) && bordersAt(body, 'columns', col, row)
      if (upright && crossesAt(body, 'columns', col, row)) out.push({ col, row })
    }
  }
  return out
}

/** Line `line` of `axis` as one stretch, from the layout's one edge to the other (what a crossing handle moves). */
export function wholeLine(body: LayoutBody, axis: GridAxis, line: number): EdgeStretch {
  return { axis, line, from: 0, to: body.grid[crossAxis(axis)].length }
}

/**
 * The stretch of line between cells `aId` and `bId` (neighbours): the edge
 * they share, extended along the line while the cells on both sides keep
 * bordering it, up to a "+" crossing. `null` when they don't touch.
 */
export function edgeBetween(body: LayoutBody, aId: string, bId: string): EdgeStretch | null {
  const a = cellById(body, aId)
  const b = cellById(body, bId)
  if (!a || !b) return null
  const p = rectOf(a.area)
  const q = rectOf(b.area)
  if ((p.c1 === q.c0 || q.c1 === p.c0) && overlaps(p.r0, p.r1, q.r0, q.r1)) {
    return extendStretch(body, 'columns', p.c1 === q.c0 ? p.c1 : q.c1, Math.max(p.r0, q.r0), Math.min(p.r1, q.r1))
  }
  if ((p.r1 === q.r0 || q.r1 === p.r0) && overlaps(p.c0, p.c1, q.c0, q.c1)) {
    return extendStretch(body, 'rows', p.r1 === q.r0 ? p.r1 : q.r1, Math.max(p.c0, q.c0), Math.min(p.c1, q.c1))
  }
  return null
}

/** Every stretch of every inner line — its pieces between "+" crossings: the dividers, one per stretch, in line order. */
export function edgeStretches(body: LayoutBody): EdgeStretch[] {
  const out: EdgeStretch[] = []
  for (const axis of ['columns', 'rows'] as const) {
    const count = body.grid[crossAxis(axis)].length
    for (let line = 1; line < body.grid[axis].length; line++) {
      let t = 0
      while (t < count) {
        if (!bordersAt(body, axis, line, t)) {
          t++
          continue
        }
        const stretch = extendStretch(body, axis, line, t, t + 1)
        out.push(stretch)
        t = stretch.to
      }
    }
  }
  return out
}

/** Whether a stretch is its whole line (from the layout's one edge to the other). */
export function isWholeLine(body: LayoutBody, stretch: EdgeStretch): boolean {
  return stretch.from === 0 && stretch.to === body.grid[crossAxis(stretch.axis)].length
}

/** The cells on either side of a stretch: `before` ending on it (left / above), `after` starting on it, each in order along it. */
export function stretchCells(body: LayoutBody, stretch: EdgeStretch): { before: LayoutCell[]; after: LayoutCell[] } {
  const cross = crossAxis(stretch.axis)
  const within = (c: LayoutCell) => {
    const [s, e] = spanOf(c.area, cross)
    return s >= stretch.from && e <= stretch.to
  }
  const along = (a: LayoutCell, b: LayoutCell) => spanOf(a.area, cross)[0] - spanOf(b.area, cross)[0]
  return {
    before: body.cells.filter((c) => spanOf(c.area, stretch.axis)[1] === stretch.line && within(c)).sort(along),
    after: body.cells.filter((c) => spanOf(c.area, stretch.axis)[0] === stretch.line && within(c)).sort(along),
  }
}
