import type { DataRow, DataSet } from '../../schema-upgrades'
import { idMinter } from '../id-minter'

/**
 * v78, part 1 (D26 P1) — a layout becomes a table: grid lines across and
 * down, and cells covering rectangles of tracks, in place of columns → rows
 * → cells and the two bands.
 *
 * The lines come from the layout's geometry as v77 drew it:
 *
 * - **Across** (x, the column tracks): the columns' weights give each
 *   column's span of the width; inside a column, each row's cells' weights
 *   give their spans of it. A band's cells' weights give their spans of the
 *   whole width.
 * - **Down** (y, the row tracks): a top band is a fixed track at the top
 *   (`px` its height), a bottom band one at the bottom. Between them, each
 *   column's rows' weights give their spans of the column area's height —
 *   a **fit row** (every cell one Number) has no weight of its own, so for
 *   the ordering only it counts as a nominal 76px of an 800px column area
 *   (at most half of it together); a collapsed row counts by its weight.
 * - Every distinct position is a line (positions within 1e-9 of each other
 *   are one), so lines that met in v77 meet in the table; each cell covers
 *   the tracks between its edges. The weighted tracks' weights scale to
 *   whole numbers summing to 1000 on each axis (each at least 1).
 * - A row track is collapsed when every cell covering it came from a
 *   collapsed row (or band).
 * - A layout with bands but no columns keeps its empty column area as one
 *   empty cell (no tabs) across a weighted row between them.
 *
 * Each cell keeps its id, tabs and active tab; its `weight` and `stripShown`
 * go (tabs on demand, D26 P3, replaces the strip choice), as does the
 * layout's `activeColumnId` (the phone shows every cell in one scroll).
 * A band's track takes the band's id; the other tracks get fresh ids,
 * `grid-c<i>` / `grid-r<i>` (`i` from 1, in order), with `_2`, `_3`, …
 * after one the layout already holds — every id it holds counts —, so the
 * same layout always upgrades to the same ids, and a draft's base upgrades
 * to what its stored layout does.
 *
 * Over the `layouts` table, and kept layout drafts (through the pipeline:
 * each body read as a layout row). Holds its own copy of everything it
 * reads, so it goes on meaning this whatever later builds do. Defensive: a
 * column, row, band or cell that isn't an object, or a column / row / band
 * without its list of parts, is left out (the parts beside it fill its
 * place); a bad weight counts as 1, a bad band height as 160px. A row that
 * already has a `grid` (or has no `columns`) is returned as it is
 * (idempotent).
 */

type Obj = Record<string, unknown>

function isRecord(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The longest id a layout part may have (`layout-shape`'s limit). */
const MAX_ID_LEN = 100
/** The largest size `layout-shape` keeps (`LAYOUT_SIZE_MAX`). */
const SIZE_MAX = 1_000_000
/** A fit row's nominal height and the column area's, for the ordering only. */
const FIT_ROW_PX = 76
const COLUMN_AREA_PX = 800
/** The most of the column area the fit rows of a column take together. */
const FIT_SHARE_MAX = 0.5
/** A band's height when it has none that reads. */
const BAND_HEIGHT = 160
/** What each axis's weights sum to. */
const WEIGHT_TOTAL = 1000
/** Positions this close are one line. */
const EPSILON = 1e-9

/** The widget kinds whose content set a row's height in v77: a row of them only was a fit row. */
const FIT_KINDS: ReadonlySet<string> = new Set(['number'])

function weightOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= SIZE_MAX ? v : 1
}

function heightOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= SIZE_MAX ? v : BAND_HEIGHT
}

/** Every string `id` anywhere under `node`. */
function collectIds(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectIds(item, into)
    return
  }
  if (!isRecord(node)) return
  if (typeof node.id === 'string') into.add(node.id)
  for (const [key, value] of Object.entries(node)) if (key !== 'id') collectIds(value, into)
}

/** The parts of `list` that are objects (and, with `key`, hold a list there). */
function records(list: unknown, key?: string): Obj[] {
  if (!Array.isArray(list)) return []
  return list.filter((v): v is Obj => isRecord(v) && (key === undefined || Array.isArray(v[key])))
}

/** A v77 cell as the table needs it: its kept keys, and the box it covered. */
interface Placed {
  cell: Obj
  x0: number
  x1: number
  y0: number
  y1: number
  collapsed: boolean
}

/** A row whose every cell held one tab, of a kind that set its height (a Number). */
function isFitRow(cells: readonly Obj[]): boolean {
  return cells.length > 0 && cells.every((c) => {
    const tabs = c.tabs as unknown[]
    const only = tabs.length === 1 ? tabs[0] : undefined
    return isRecord(only) && typeof only.kind === 'string' && FIT_KINDS.has(only.kind)
  })
}

/** `cells` side by side over `x0 … x1` by their weights. */
function spread(cells: readonly Obj[], x0: number, x1: number, y0: number, y1: number, collapsed: boolean, out: Placed[]): void {
  const total = cells.reduce((sum, c) => sum + weightOf(c.weight), 0)
  let at = 0
  for (const c of cells) {
    const w = weightOf(c.weight)
    out.push({ cell: c, x0: x0 + (x1 - x0) * (at / total), x1: x0 + (x1 - x0) * ((at + w) / total), y0, y1, collapsed })
    at += w
  }
}

/** Positions as lines: sorted, within `EPSILON` of each other merged. */
function linesOf(positions: readonly number[]): number[] {
  const sorted = [...positions].sort((a, b) => a - b)
  const lines: number[] = []
  for (const p of sorted) {
    const last = lines.at(-1)
    if (last === undefined || p - last > EPSILON) lines.push(p)
  }
  return lines
}

/**
 * The index of the line nearest `p` (the first of two equally near), in
 * `lines` as `linesOf` makes them: ascending, each more than `EPSILON` past
 * the one before. A binary search for the first line at or past `p`, then
 * the nearer of it and the line before it — the one a scan of every line
 * finds, without the scan (four scans per cell took 12.8 s on a crafted
 * file of 32,000 cells, cr34 S1).
 */
function lineIndex(lines: readonly number[], p: number): number {
  let lo = 0
  let hi = lines.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((lines[mid] ?? 0) < p) lo = mid + 1
    else hi = mid
  }
  // `lo`: the first line at or past `p` (one past the last line when none is).
  if (lo === 0) return 0
  if (lo >= lines.length) return lines.length - 1
  return Math.abs((lines[lo] ?? 0) - p) < Math.abs((lines[lo - 1] ?? 0) - p) ? lo : lo - 1
}

/** `shares` (summing to 1) as whole numbers summing to `WEIGHT_TOTAL` (largest remainder), each at least 1. */
function scaled(shares: readonly number[]): number[] {
  const raw = shares.map((s) => s * WEIGHT_TOTAL)
  const out = raw.map((r) => Math.floor(r))
  let left = WEIGHT_TOTAL - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) {
    const i = order[k]?.i
    if (i !== undefined) out[i] = (out[i] ?? 0) + 1
  }
  return out.map((w) => Math.max(1, w))
}

/** A layout row (or a kept draft's body) as a table; the row itself when it is one already or has no columns. */
export function layoutTableOf(row: DataRow): DataRow {
  if (!isRecord(row) || row.grid !== undefined || !Array.isArray(row.columns)) return row
  const taken = new Set<string>()
  collectIds([row.columns, row.top, row.bottom], taken)
  const mint = idMinter(taken, MAX_ID_LEN, '_')

  const placed: Placed[] = []
  // The column area: x over the width, y over its height (0 … 1).
  const columns = records(row.columns, 'rows')
  const colTotal = columns.reduce((sum, c) => sum + weightOf(c.weight), 0)
  let colAt = 0
  for (const col of columns) {
    const w = weightOf(col.weight)
    const x0 = colAt / colTotal
    const x1 = (colAt + w) / colTotal
    colAt += w
    const rows = records(col.rows, 'cells').map((r) => ({ row: r, cells: records(r.cells, 'tabs') })).filter((r) => r.cells.length > 0)
    const fit = rows.map((r) => isFitRow(r.cells))
    const fitCount = fit.filter(Boolean).length
    const weightedTotal = rows.reduce((sum, r, i) => (fit[i] ? sum : sum + weightOf(r.row.weight)), 0)
    const fitEach = weightedTotal > 0
      ? Math.min(fitCount * (FIT_ROW_PX / COLUMN_AREA_PX), FIT_SHARE_MAX) / Math.max(1, fitCount)
      : 1 / Math.max(1, fitCount)
    const weightedShare = 1 - fitEach * fitCount
    let y = 0
    rows.forEach((r, i) => {
      const h = fit[i] ? fitEach : weightedShare * (weightOf(r.row.weight) / weightedTotal)
      spread(r.cells, x0, x1, y, y + h, r.row.collapsed === true, placed)
      y += h
    })
  }

  // The bands: fixed tracks above and below; with no columns between them, an empty cell keeps the column area.
  const bands: Array<{ edge: 'top' | 'bottom'; band: Obj; cells: Obj[] }> = []
  for (const edge of ['top', 'bottom'] as const) {
    const band = row[edge]
    if (!isRecord(band) || !Array.isArray(band.cells)) continue
    const cells = records(band.cells, 'tabs')
    if (cells.length > 0) bands.push({ edge, band, cells })
  }
  if (placed.length === 0 && bands.length > 0) {
    placed.push({ cell: { id: mint('grid', '-empty'), tabs: [] }, x0: 0, x1: 1, y0: 0, y1: 1, collapsed: false })
  }

  const xs = linesOf([0, 1, ...placed.flatMap((p) => [p.x0, p.x1]), ...bands.flatMap((b) => {
    const out: Placed[] = []
    spread(b.cells, 0, 1, 0, 0, false, out)
    return out.flatMap((p) => [p.x0, p.x1])
  })])
  const ys = placed.length > 0 ? linesOf([0, 1, ...placed.flatMap((p) => [p.y0, p.y1])]) : []
  const hasColumnArea = ys.length > 0

  const colTracks = xs.length > 1
    ? scaled(xs.slice(1).map((x, i) => x - (xs[i] ?? 0))).map((weight, i) => ({ id: mint('grid', `-c${i + 1}`), weight }))
    : []
  const areaTracks = hasColumnArea
    ? scaled(ys.slice(1).map((y, i) => y - (ys[i] ?? 0))).map((weight, i) => ({ id: mint('grid', `-r${i + 1}`), weight }))
    : []
  const top = bands.find((b) => b.edge === 'top')
  const bottom = bands.find((b) => b.edge === 'bottom')
  const bandTrack = (b: { band: Obj }) => {
    const id = typeof b.band.id === 'string' && b.band.id !== '' ? b.band.id : mint('grid', '-band')
    return { id, px: heightOf(b.band.height), ...(b.band.collapsed === true ? { collapsed: true } : {}) }
  }
  const offset = top ? 1 : 0

  const cells: Obj[] = []
  const coveredBy: boolean[][] = areaTracks.map(() => [])
  const cellOf = (p: Placed, rowIdx: number, rowSpan: number): Obj => {
    const c0 = lineIndex(xs, p.x0)
    const c1 = lineIndex(xs, p.x1)
    const { weight: _w, stripShown: _s, ...rest } = p.cell
    void _w
    void _s
    return { ...rest, area: { col: c0, row: rowIdx, colSpan: Math.max(1, c1 - c0), rowSpan } }
  }
  if (top) {
    const out: Placed[] = []
    spread(top.cells, 0, 1, 0, 0, false, out)
    for (const p of out) cells.push(cellOf(p, 0, 1))
  }
  for (const p of placed) {
    const r0 = lineIndex(ys, p.y0)
    const r1 = Math.max(r0 + 1, lineIndex(ys, p.y1))
    for (let r = r0; r < r1; r++) coveredBy[r]?.push(p.collapsed)
    cells.push(cellOf(p, offset + r0, r1 - r0))
  }
  if (bottom) {
    const out: Placed[] = []
    spread(bottom.cells, 0, 1, 0, 0, false, out)
    for (const p of out) cells.push(cellOf(p, offset + areaTracks.length, 1))
  }

  const rowTracks = [
    ...(top ? [bandTrack(top)] : []),
    ...areaTracks.map((t, r) => {
      const flags = coveredBy[r] ?? []
      return flags.length > 0 && flags.every(Boolean) ? { ...t, collapsed: true } : t
    }),
    ...(bottom ? [bandTrack(bottom)] : []),
  ]

  // In reading order: by the top track, then the left.
  const areaKey = (c: Obj) => c.area as { row: number; col: number }
  cells.sort((a, b) => areaKey(a).row - areaKey(b).row || areaKey(a).col - areaKey(b).col)

  const { columns: _c, top: _t, bottom: _b, activeColumnId: _a, ...kept } = row
  void _c
  void _t
  void _b
  void _a
  return {
    ...kept,
    grid: { columns: cells.length > 0 ? colTracks : [], rows: cells.length > 0 ? rowTracks : [] },
    cells,
  }
}

export function upgradeLayoutTable(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!layouts) return data
  const next = layouts.map(layoutTableOf)
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
