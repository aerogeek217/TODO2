import type { DataRow, DataSet } from '../../schema-upgrades'

/**
 * v88 — the List wall and Shortcuts are one widget, the List board (kind
 * `shortcuts`): in every layout, each `listwall` tab becomes a List board
 * showing its layout's lists, `{ kind: 'shortcuts', config: { source:
 * 'layout' } }`. Its id, name, icon and every other field stay, and so does
 * its place in its cell (the cell's active tab too). Nothing else moves.
 *
 * Follows the transform contract (`schema-upgrades`): pure, idempotent (a
 * layout without a List wall comes back as the same object), tolerant of
 * missing tables and malformed rows (a cell or tab that isn't an object, a
 * cell without a list of tabs: left for the layout repair); a table it
 * leaves alone comes back as the same array.
 */

type Obj = Record<string, unknown>

const isRecord = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A List wall's tab as a List board of its layout's lists; any other tab as it is. */
function boardOf(tab: unknown): unknown {
  if (!isRecord(tab) || tab.kind !== 'listwall') return tab
  return { ...tab, kind: 'shortcuts', config: { source: 'layout' } }
}

/** A cell with its List walls made List boards (the same object when it has none). */
function cellOf(cell: unknown): unknown {
  if (!isRecord(cell) || !Array.isArray(cell.tabs)) return cell
  const tabs = cell.tabs as unknown[]
  const next = tabs.map(boardOf)
  return next.every((t, i) => t === tabs[i]) ? cell : { ...cell, tabs: next }
}

/** A layout row with its List walls made List boards (the same object when it has none). */
function layoutOf(row: DataRow): DataRow {
  if (!Array.isArray(row.cells)) return row
  const cells = row.cells as unknown[]
  const next = cells.map(cellOf)
  return next.every((c, i) => c === cells[i]) ? row : { ...row, cells: next }
}

export function upgradeV88(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!Array.isArray(layouts)) return data
  const next = layouts.map((row) => (isRecord(row) ? layoutOf(row) : row))
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
