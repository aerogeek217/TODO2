import {
  BAND_EDGES,
  type BandEdge,
  type LayoutBody,
  type WorkspaceLayout,
} from '../models/workspace-layout'
import { findRow, layoutRows, rowAt } from './workspace-layout-queries'
import { isPositive, setRowAt, withBand, withColumns } from './workspace-layout-edit'

/**
 * A layout's sizes: the columns', rows' and cells' weights (a divider drag
 * sets two neighbours at once), a band's height, and the size groups that
 * resize together — copied between two bodies where both have the same
 * parts (`copySizes`). Sizes are view state. Each write returns the same
 * object when nothing changes.
 */

/** A band's height (px, rounded). No band there or a bad height → unchanged. */
export function setBandHeight<L extends WorkspaceLayout>(layout: L, edge: BandEdge, height: number): L {
  const band = layout[edge]
  if (!band || !isPositive(height)) return layout
  const rounded = Math.max(1, Math.round(height))
  return rounded === band.height ? layout : withBand(layout, edge, { ...band, height: rounded })
}

/** `parts` with the weights `weightById` names (positive, finite, changed); `null` when none applies. */
function weighted<P extends { id: string; weight: number }>(parts: readonly P[], weightById: Readonly<Record<string, number>>): P[] | null {
  let changed = false
  const next = parts.map((part) => {
    const w = weightById[part.id]
    if (!isPositive(w) || w === part.weight) return part
    changed = true
    return { ...part, weight: w }
  })
  return changed ? next : null
}

/**
 * Batched resize: sets the weight of every listed column (by id) at once, so
 * a divider drag updates its two neighbours together. Unknown ids and
 * non-positive / non-finite weights are ignored.
 */
export function setColumnWeights<L extends WorkspaceLayout>(layout: L, weightById: Readonly<Record<string, number>>): L {
  const columns = weighted(layout.columns, weightById)
  return columns ? withColumns(layout, columns) : layout
}

/** Batched resize of rows (by id, in any columns: their share of the column's height). Same rules as `setColumnWeights`. */
export function setRowWeights<L extends WorkspaceLayout>(layout: L, weightById: Readonly<Record<string, number>>): L {
  let changed = false
  const columns = layout.columns.map((col) => {
    const rows = weighted(col.rows, weightById)
    if (!rows) return col
    changed = true
    return { ...col, rows }
  })
  return changed ? withColumns(layout, columns) : layout
}

/** Batched resize of cells (by id, in any rows and bands: their share of the row's width). Same rules as `setColumnWeights`. */
export function setCellWeights<L extends WorkspaceLayout>(layout: L, weightById: Readonly<Record<string, number>>): L {
  let next = layout
  for (const row of layoutRows(layout)) {
    const cells = weighted(row.cells, weightById)
    const loc = cells ? findRow(next, row.id) : null
    if (cells && loc) next = setRowAt(next, loc, { ...row, cells })
  }
  return next
}

/**
 * Sizes that resize together, as one divider moves them: the columns'
 * weights, one column's rows' weights, one row's (or band's) cells' weights,
 * or a band's height.
 */
export type SizeGroup =
  | { kind: 'columns' }
  | { kind: 'rows'; columnId: string }
  | { kind: 'cells'; rowId: string }
  | { kind: 'band'; edge: BandEdge }

/** The size groups of the rows `rowIds` (their columns' rows), in `layout`. */
export function rowSizeGroups(layout: LayoutBody, rowIds: Iterable<string>): SizeGroup[] {
  const ids = new Set(rowIds)
  return layout.columns
    .filter((col) => col.rows.some((row) => ids.has(row.id)))
    .map((col) => ({ kind: 'rows', columnId: col.id }))
}

/** The size groups of the cells `cellIds` (their rows' or bands' cells), in `layout`. */
export function cellSizeGroups(layout: LayoutBody, cellIds: Iterable<string>): SizeGroup[] {
  const ids = new Set(cellIds)
  return layoutRows(layout)
    .filter((row) => row.cells.some((cell) => ids.has(cell.id)))
    .map((row) => ({ kind: 'cells', rowId: row.id }))
}

function sameIds(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i]?.id)
}

/** Every size group of `layout`: the columns, each column's rows, each row's and band's cells, each band. */
function allSizeGroups(layout: LayoutBody): SizeGroup[] {
  return [
    { kind: 'columns' },
    ...layout.columns.map((col): SizeGroup => ({ kind: 'rows', columnId: col.id })),
    ...layoutRows(layout).map((row): SizeGroup => ({ kind: 'cells', rowId: row.id })),
    ...BAND_EDGES.map((edge): SizeGroup => ({ kind: 'band', edge })),
  ]
}

/**
 * `target` with the sizes of `groups` (`all`: every column, row, cell and
 * band size) copied from `source` — each group only where both have the same
 * parts: the columns' weights when both have the same columns (by id, in
 * order), a column's rows' weights when that column has the same rows in
 * both, a row's (or band's) cells' weights when that row has the same cells
 * in both, a band's height when both have that band. Other sizes stay. The
 * same object when nothing changes.
 */
export function copySizes<L extends WorkspaceLayout>(target: L, source: LayoutBody, groups: readonly SizeGroup[] | 'all'): L {
  const list = groups === 'all' ? allSizeGroups(target) : groups
  let next = target
  for (const group of list) {
    switch (group.kind) {
      case 'band': {
        const from = source[group.edge]
        if (from && next[group.edge]?.id === from.id) next = setBandHeight(next, group.edge, from.height)
        break
      }
      case 'columns':
        if (sameIds(next.columns, source.columns)) {
          next = setColumnWeights(next, Object.fromEntries(source.columns.map((col) => [col.id, col.weight])))
        }
        break
      case 'rows': {
        const from = source.columns.find((col) => col.id === group.columnId)
        const to = next.columns.find((col) => col.id === group.columnId)
        if (from && to && sameIds(to.rows, from.rows)) {
          next = setRowWeights(next, Object.fromEntries(from.rows.map((row) => [row.id, row.weight])))
        }
        break
      }
      case 'cells': {
        const fromLoc = findRow(source, group.rowId)
        const toLoc = findRow(next, group.rowId)
        const from = fromLoc ? rowAt(source, fromLoc) : undefined
        const to = toLoc ? rowAt(next, toLoc) : undefined
        if (from && to && sameIds(to.cells, from.cells)) {
          next = setCellWeights(next, Object.fromEntries(from.cells.map((cell) => [cell.id, cell.weight])))
        }
        break
      }
    }
  }
  return next
}
