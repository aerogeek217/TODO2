import type { DataRow, DataSet } from '../schema-upgrades'
import { idMinter } from './id-minter'

/**
 * v76 — every column is rows: a layout becomes columns → rows → cells, and a
 * band becomes one row of cells.
 *
 * - Each cell of a column becomes a one-cell row: `{ id: <cell>-r, weight:
 *   the cell's weight, collapsed: the cell's, cells: [the cell, weight 1] }`
 *   — the cell's height share becomes its row's, and the cell (alone in its
 *   row) takes the whole width; `collapsed` moves from the cell to its row.
 * - Each band keeps its id, height and `collapsed`; its tabs and active tab
 *   become its one cell `{ id: <band>-c, weight: 1, tabs, activeTabId }`.
 *
 * A fresh id is the part's own id plus `-r` / `-c` (cut so the result stays
 * within the 100 characters an id may have), with `2`, `3`, … after it when
 * the layout already holds that id — every id the layout holds, at any
 * level, counts — so the same layout always upgrades to the same ids, and
 * a draft's base upgrades to what its stored layout does.
 *
 * Over the `layouts` table, and kept layout drafts (through the pipeline:
 * each body read as a layout row). Holds its own copy of the reshaping: this
 * step must go on meaning this whatever later builds do. A part it can't read
 * (a column without a `cells` list, a cell or band that isn't an object)
 * passes through, for the layout repair to drop; a column that already has
 * `rows` and a band that already has `cells` stay as they are (idempotent).
 */

type Obj = Record<string, unknown>

function isRecord(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The longest id a layout part may have (`layout-shape`'s limit). */
const MAX_ID_LEN = 100

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

type Mint = ReturnType<typeof idMinter>

/** A column's cell as a one-cell row; a cell that isn't an object passes through. */
function rowOf(cell: unknown, mint: Mint): unknown {
  if (!isRecord(cell)) return cell
  const { collapsed, weight, ...rest } = cell
  return {
    id: mint(cell.id, '-r'),
    weight,
    ...(collapsed !== undefined ? { collapsed } : {}),
    cells: [{ ...rest, weight: 1 }],
  }
}

function upgradeColumn(col: unknown, mint: Mint): unknown {
  if (!isRecord(col) || col.rows !== undefined || !Array.isArray(col.cells)) return col
  const { cells, ...rest } = col
  return { ...rest, rows: (cells as unknown[]).map((cell) => rowOf(cell, mint)) }
}

function upgradeBand(band: unknown, mint: Mint): unknown {
  if (!isRecord(band) || band.cells !== undefined) return band
  const { tabs, activeTabId, ...rest } = band
  const cell: Obj = { id: mint(band.id, '-c'), weight: 1, tabs }
  if (activeTabId !== undefined) cell.activeTabId = activeTabId
  return { ...rest, cells: [cell] }
}

/** A layout row (or a kept draft's body) in the rows shape; the row itself when nothing changes. */
function upgradeLayout(row: DataRow): DataRow {
  if (!isRecord(row)) return row
  const taken = new Set<string>()
  collectIds([row.columns, row.top, row.bottom], taken)
  const mint = idMinter(taken, MAX_ID_LEN, '')
  let out: DataRow = row
  if (Array.isArray(row.columns)) {
    const columns = (row.columns as unknown[]).map((col) => upgradeColumn(col, mint))
    if (columns.some((col, i) => col !== (row.columns as unknown[])[i])) out = { ...out, columns }
  }
  for (const edge of ['top', 'bottom'] as const) {
    if (row[edge] === undefined) continue
    const band = upgradeBand(row[edge], mint)
    if (band !== row[edge]) out = { ...out, [edge]: band }
  }
  return out
}

export function upgradeV76(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!layouts) return data
  const next = layouts.map(upgradeLayout)
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
