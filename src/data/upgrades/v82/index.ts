import type { DataRow, DataSet } from '../../schema-upgrades'
import { isRecord, type Obj } from '../layout-tabs'

/**
 * v82 — Numbers as a strip (flair P10, user 2026-11-15: existing rows are
 * converted automatically): a cell of only Numbers now draws them side by
 * side, evenly divided. In every layout, in each row track that fits today —
 * every cell lying only in it holds exactly one Number —, each run of two
 * or more side-by-side Number cells becomes one cell holding those Numbers
 * in left-to-right order: the first cell's id and active tab, the first
 * Number in front. Then every inner column line no cell's edge lies on goes
 * (its two tracks merge: the first's id, the sizes added — two fixed
 * tracks' px, else the weights —, collapsed only when both were), and the
 * cells are put in reading order. A lone Number cell, a row holding any
 * other kind, and the row tracks themselves (their sizes, `fitPx`) are left
 * as they were.
 *
 * Holds its own copy of what it reads (the line merge), so it goes on
 * meaning what it means whatever later builds do. Follows the transform
 * contract (`schema-upgrades`): pure, idempotent (a merged cell holds two or
 * more Numbers, so it starts no run again), tolerant of missing tables and
 * malformed rows — a layout whose table doesn't read (no track lists, a
 * cell without a whole-number area or a list of tabs) is left for the
 * layout repair —; a table it leaves alone comes back as the same array.
 */

/** A cell's area in tracks, as `[c0, c1, r0, r1)`. */
interface Rect {
  c0: number
  c1: number
  r0: number
  r1: number
}

function isTrackIndex(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min
}

function rectOf(cell: Obj): Rect | null {
  const a = cell.area
  if (!isRecord(a) || !isTrackIndex(a.col, 0) || !isTrackIndex(a.row, 0) || !isTrackIndex(a.colSpan, 1) || !isTrackIndex(a.rowSpan, 1)) return null
  return { c0: a.col, c1: a.col + a.colSpan, r0: a.row, r1: a.row + a.rowSpan }
}

function areaOf(r: Rect): Obj {
  return { col: r.c0, row: r.r0, colSpan: r.c1 - r.c0, rowSpan: r.r1 - r.r0 }
}

/** A cell holding exactly one tab, a Number. */
function isOneNumber(cell: Obj): boolean {
  const tabs = cell.tabs
  return Array.isArray(tabs) && tabs.length === 1 && isRecord(tabs[0]) && tabs[0].kind === 'number'
}

/** Two column tracks as one, when the line between them goes. */
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

/** The column tracks without the inner lines no cell's edge lies on, and each rectangle's columns moved down by those dropped before them. */
function mergeColumnLines(columns: unknown[], rects: Rect[]): { columns: unknown[]; rects: Rect[] } {
  const edges = new Set<number>()
  for (const r of rects) {
    edges.add(r.c0)
    edges.add(r.c1)
  }
  const merged: unknown[] = []
  const droppedUpTo: number[] = [0]
  let dropped = 0
  for (let line = 0; line < columns.length; line++) {
    if (line === 0 || edges.has(line)) {
      merged.push(columns[line])
    } else {
      merged[merged.length - 1] = mergedTrack(merged[merged.length - 1], columns[line])
      dropped++
    }
    droppedUpTo[line] = dropped
  }
  if (dropped === 0) return { columns, rects }
  const moved = (edge: number) => edge - (droppedUpTo[edge] ?? dropped)
  return { columns: merged, rects: rects.map((r) => ({ ...r, c0: moved(r.c0), c1: moved(r.c1) })) }
}

/** A layout row with its fit rows' runs of Number cells merged into strips; the row itself when there are none. */
function stripsOf(row: DataRow): DataRow {
  if (!isRecord(row) || !Array.isArray(row.cells) || !isRecord(row.grid)) return row
  const grid = row.grid
  if (!Array.isArray(grid.columns) || !Array.isArray(grid.rows)) return row
  const cells: Obj[] = []
  const rects: Rect[] = []
  for (const c of row.cells as unknown[]) {
    const r = isRecord(c) && Array.isArray(c.tabs) ? rectOf(c) : null
    if (!isRecord(c) || !r) return row
    cells.push(c)
    rects.push(r)
  }

  const gone = new Set<number>()
  let merged = false
  for (let track = 0; track < grid.rows.length; track++) {
    const own = rects.map((r, i) => ({ r, i })).filter(({ r }) => r.r0 === track && r.r1 === track + 1)
    if (own.length === 0 || !own.every(({ i }) => isOneNumber(cells[i] as Obj))) continue
    own.sort((a, b) => a.r.c0 - b.r.c0)
    // Runs of cells side by side (one's right edge the next's left).
    let run: number[] = []
    const flush = () => {
      const [first, ...rest] = run
      if (first !== undefined && rest.length > 0) {
        const head = cells[first] as Obj
        const tabs = run.flatMap((i) => (cells[i] as Obj).tabs as unknown[])
        cells[first] = { ...head, tabs }
        rects[first] = { ...(rects[first] as Rect), c1: (rects[run.at(-1) as number] as Rect).c1 }
        for (const i of rest) gone.add(i)
        merged = true
      }
      run = []
    }
    for (const { r, i } of own) {
      const last = run.at(-1)
      if (last !== undefined && (rects[last] as Rect).c1 !== r.c0) flush()
      run.push(i)
    }
    flush()
  }
  if (!merged) return row

  const keptCells = cells.filter((_, i) => !gone.has(i))
  const keptRects = rects.filter((_, i) => !gone.has(i))
  const { columns, rects: placedRects } = mergeColumnLines(grid.columns, keptRects)
  const placed = keptCells
    .map((cell, i) => ({ cell, r: placedRects[i] as Rect }))
    .sort((a, b) => a.r.r0 - b.r.r0 || a.r.c0 - b.r.c0)
    .map(({ cell, r }) => ({ ...cell, area: areaOf(r) }))
  return { ...row, grid: { ...grid, columns }, cells: placed }
}

export function upgradeV82(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!layouts) return data
  const next = layouts.map(stripsOf)
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
