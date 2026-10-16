import type { DataRow, DataSet } from '../schema-upgrades'
import { isRecord } from '../../utils/is-record'

/**
 * v57 — list favorites and saved prompt picks go.
 *
 * - `listDefinitions[].favorited` is removed (the favorites bar is gone).
 * - Workspace list tabs stop saving the picks of a list's runtime prompt: a
 *   pick is temporary and empty after a reload, so `layouts[].columns[].cells[]
 *   .tabs[].viewState.runtimeFilterValue` is removed (and an emptied
 *   `viewState` with it). Only the prompt's field, on the list definition,
 *   is kept. The canvas (`listInsets`, rail tabs) keeps its own picks.
 *
 * Idempotent; tolerates missing tables and malformed rows (passed through).
 */

type Obj = Record<string, unknown>

function upgradeListDefinitions(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row) || !('favorited' in row)) return row
    changed = true
    const next: DataRow = { ...row }
    delete next.favorited
    return next
  })
  return changed ? out : rows
}

/** The tab without saved prompt picks, or the same object when it has none. */
function stripTabPicks(tab: unknown): unknown {
  if (!isRecord(tab) || tab.kind !== 'lens' || !isRecord(tab.viewState)) return tab
  if (!('runtimeFilterValue' in tab.viewState)) return tab
  const viewState: Obj = { ...tab.viewState }
  delete viewState.runtimeFilterValue
  const next: Obj = { ...tab }
  if (Object.keys(viewState).length > 0) next.viewState = viewState
  else delete next.viewState
  return next
}

/** Maps `fn` over `items`; the same array when no item changed. */
function mapSame<T>(items: readonly T[], fn: (item: T) => T): readonly T[] {
  let changed = false
  const out = items.map((item) => {
    const next = fn(item)
    if (next !== item) changed = true
    return next
  })
  return changed ? out : items
}

function upgradeLayout(row: DataRow): DataRow {
  if (!isRecord(row) || !Array.isArray(row.columns)) return row
  const columns = mapSame<unknown>(row.columns, (col) => {
    if (!isRecord(col) || !Array.isArray(col.cells)) return col
    const cells = mapSame<unknown>(col.cells, (cell) => {
      if (!isRecord(cell) || !Array.isArray(cell.tabs)) return cell
      const tabs = mapSame<unknown>(cell.tabs, stripTabPicks)
      return tabs === cell.tabs ? cell : { ...cell, tabs }
    })
    return cells === col.cells ? col : { ...col, cells }
  })
  return columns === row.columns ? row : { ...row, columns }
}

function upgradeLayouts(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  return mapSame(rows, upgradeLayout) as DataRow[]
}

/** v57 — strip `listDefinitions[].favorited` and saved list-tab prompt picks. */
export function upgradeV57(data: DataSet): DataSet {
  const out: DataSet = { ...data }
  const listDefinitions = upgradeListDefinitions(data.listDefinitions)
  if (listDefinitions !== undefined && listDefinitions !== data.listDefinitions) out.listDefinitions = listDefinitions
  const layouts = upgradeLayouts(data.layouts)
  if (layouts !== undefined && layouts !== data.layouts) out.layouts = layouts
  return out
}
