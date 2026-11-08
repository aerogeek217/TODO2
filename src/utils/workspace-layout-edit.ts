import {
  type BandEdge,
  type LayoutBand,
  type LayoutCell,
  type LayoutCellRow,
  type LayoutColumn,
  type LayoutRow,
  type WorkspaceLayout,
} from '../models/workspace-layout'
import { type CellLocation, rowAt, type RowLocation, rowLocOf } from './workspace-layout-queries'

/**
 * The immutable setters the layout reducers (`workspace-layout-ops`) and
 * the size writes (`workspace-layout-sizes`) share: put back a column's row,
 * a row, a band or a cell, keeping the structural invariants those modules
 * describe (an emptied part goes; a column left only collapsed rows expands
 * one). Internal to the layout modules.
 */

export function withColumns<L extends WorkspaceLayout>(layout: L, columns: LayoutColumn[]): L {
  return { ...layout, columns }
}

/** `layout` with the band at `edge` replaced (`null` removes it: the key goes). */
export function withBand<L extends WorkspaceLayout>(layout: L, edge: BandEdge, band: LayoutBand | null): L {
  const next = { ...layout }
  if (band) next[edge] = band
  else delete next[edge]
  return next
}

export function replaceAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  const next = arr.slice()
  next[idx] = value
  return next
}

export function insertAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  return insertAllAt(arr, idx, [value])
}

export function insertAllAt<T>(arr: readonly T[], idx: number, values: readonly T[]): T[] {
  const clamped = Math.max(0, Math.min(idx, arr.length))
  return [...arr.slice(0, clamped), ...values, ...arr.slice(clamped)]
}

export function removeAt<T>(arr: readonly T[], idx: number): T[] {
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)]
}

export function isPositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** `row` without `collapsed` (expanded). */
export function expanded<R extends LayoutCellRow>(row: R): R {
  const { collapsed: _drop, ...rest } = row
  void _drop
  return rest as R
}

/**
 * Replaces one row of a column; a row given as `null` is removed (and its
 * column, when that empties). When the removed row was the column's last
 * expanded one, the row above it (else the new first) expands: nothing else
 * would fill the column.
 */
export function setColumnRow<L extends WorkspaceLayout>(layout: L, colIdx: number, rowIdx: number, row: LayoutRow | null): L {
  const col = layout.columns[colIdx]
  if (!col) return layout
  if (row) return withColumns(layout, replaceAt(layout.columns, colIdx, { ...col, rows: replaceAt(col.rows, rowIdx, row) }))
  const rows = removeAt(col.rows, rowIdx)
  if (rows.length === 0) return withColumns(layout, removeAt(layout.columns, colIdx))
  const lostLastExpanded = col.rows[rowIdx]?.collapsed !== true && rows.every((r) => r.collapsed === true)
  const heirIdx = rows[rowIdx - 1] ? rowIdx - 1 : 0
  const heir = rows[heirIdx]
  const kept = lostLastExpanded && heir ? replaceAt(rows, heirIdx, expanded(heir)) : rows
  return withColumns(layout, replaceAt(layout.columns, colIdx, { ...col, rows: kept }))
}

/** Replaces one row of cells (a column's row or a band); `null` removes it (a band's key goes). */
export function setRowAt<L extends WorkspaceLayout>(layout: L, loc: RowLocation, row: LayoutCellRow | null): L {
  if (loc.kind === 'band') {
    if (!layout[loc.edge]) return layout
    return withBand(layout, loc.edge, row as LayoutBand | null)
  }
  return setColumnRow(layout, loc.colIdx, loc.rowIdx, row as LayoutRow | null)
}

/**
 * Replaces one cell; a cell given as `null` is removed — and its row (or
 * band) when that empties, and a column left without rows (`setColumnRow`).
 */
export function setCellAt<L extends WorkspaceLayout>(layout: L, loc: CellLocation, cell: LayoutCell | null): L {
  const rowLoc = rowLocOf(loc)
  const row = rowAt(layout, rowLoc)
  if (!row?.cells[loc.cellIdx]) return layout
  const cells = cell ? replaceAt(row.cells, loc.cellIdx, cell) : removeAt(row.cells, loc.cellIdx)
  return setRowAt(layout, rowLoc, cells.length === 0 ? null : { ...row, cells })
}
