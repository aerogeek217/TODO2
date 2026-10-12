import type { WorkspaceLayout } from '../../models/workspace-layout'
import { closeTab } from '../../utils/workspace-layout-ops'
import type { DataRow, DataSet } from '../schema-upgrades'

/**
 * v62 — the Status widget is retired (its bar and legend live on as the
 * Dashboard's Status section).
 *
 * Every `status` tab is dropped from every stored layout, the way closing it
 * would: its cell's active tab moves to a neighbour, a cell left without
 * tabs is removed, and a column left without cells too (the layout reducers'
 * `closeTab`). Status tabs are not converted into anything.
 *
 * Idempotent (a layout without status tabs is the same object); tolerates a
 * missing `layouts` table; a row whose shape it can't walk is passed through
 * for validation to judge.
 */

type Obj = Record<string, unknown>

function isRecord(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * The ids of the layout's status tabs, or `null` when the columns aren't the
 * columns → cells → tabs shape the reducers can walk.
 */
function statusTabIds(columns: unknown): string[] | null {
  if (!Array.isArray(columns)) return null
  const ids: string[] = []
  for (const col of columns) {
    if (!isRecord(col) || !Array.isArray(col.cells)) return null
    for (const cell of col.cells) {
      if (!isRecord(cell) || !Array.isArray(cell.tabs)) return null
      for (const tab of cell.tabs) {
        if (!isRecord(tab)) return null
        if (tab.kind === 'status' && typeof tab.id === 'string') ids.push(tab.id)
      }
    }
  }
  return ids
}

function dropStatusTabs(row: DataRow): DataRow {
  if (!isRecord(row)) return row
  const ids = statusTabIds(row.columns)
  if (ids == null || ids.length === 0) return row
  let layout = row as unknown as WorkspaceLayout
  for (const id of ids) layout = closeTab(layout, id)
  return layout as unknown as DataRow
}

/** v62 — layouts: drop every `status` tab (and the cells / columns it leaves empty). */
export function upgradeV62(data: DataSet): DataSet {
  const rows = data.layouts
  if (!Array.isArray(rows)) return data
  let changed = false
  const next = rows.map((row) => {
    const out = dropStatusTabs(row)
    if (out !== row) changed = true
    return out
  })
  return changed ? { ...data, layouts: next } : data
}
