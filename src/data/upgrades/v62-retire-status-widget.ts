import type { DataRow, DataSet } from '../schema-upgrades'

/**
 * v62 — the Status widget is retired (its bar and legend live on as the
 * Dashboard's Status section).
 *
 * Every `status` tab is dropped from every stored layout, the way closing it
 * would: its cell's active tab moves to a neighbour, a cell left without
 * tabs is removed, and a column left without cells too (what the layout
 * reducers' `closeTab` does, done in one pass). Status tabs are not converted
 * into anything.
 *
 * Idempotent (a layout without status tabs is the same object); tolerates a
 * missing `layouts` table; a row whose shape it can't walk is passed through
 * for validation to judge.
 */

type Obj = Record<string, unknown>

function isRecord(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isStatusTab(tab: Obj): boolean {
  return tab.kind === 'status' && typeof tab.id === 'string'
}

/**
 * Whether the columns are the columns → cells → tabs shape this transform
 * can walk, with at least one status tab.
 */
function hasStatusTabs(columns: unknown): columns is Obj[] {
  if (!Array.isArray(columns)) return false
  let found = false
  for (const col of columns) {
    if (!isRecord(col) || !Array.isArray(col.cells)) return false
    for (const cell of col.cells) {
      if (!isRecord(cell) || !Array.isArray(cell.tabs)) return false
      for (const tab of cell.tabs) {
        if (!isRecord(tab)) return false
        if (isStatusTab(tab)) found = true
      }
    }
  }
  return found
}

/**
 * The cell without its status tabs — what closing each of them in turn
 * (`closeTab`) leaves, in one pass: a closed active tab hands over to the
 * nearest remaining tab on its left, else on its right. `null` when no tab
 * is left (the cell goes). One pass, so a file with a huge number of tabs
 * can't make the upgrade quadratic.
 */
function cellWithoutStatusTabs(cell: Obj): Obj | null {
  const tabs = cell.tabs as Obj[]
  if (!tabs.some(isStatusTab)) return cell
  const kept = tabs.filter((t) => !isStatusTab(t))
  if (kept.length === 0) return null
  const next: Obj = { ...cell, tabs: kept }
  const activeIdx = tabs.findIndex((t) => t.id === cell.activeTabId)
  const active = tabs[activeIdx]
  if (active && isStatusTab(active)) {
    const left = tabs.slice(0, activeIdx).reverse().find((t) => !isStatusTab(t))
    const fallback = left ?? tabs.slice(activeIdx + 1).find((t) => !isStatusTab(t))
    if (fallback) next.activeTabId = fallback.id
  }
  return next
}

function dropStatusTabs(row: DataRow): DataRow {
  if (!isRecord(row) || !hasStatusTabs(row.columns)) return row
  const columns: Obj[] = []
  for (const col of row.columns) {
    const cells = (col.cells as Obj[]).flatMap((cell) => cellWithoutStatusTabs(cell) ?? [])
    if (cells.length === 0 && (col.cells as Obj[]).length > 0) continue
    columns.push(cells.length === (col.cells as Obj[]).length && cells.every((c, i) => c === (col.cells as Obj[])[i]) ? col : { ...col, cells })
  }
  return { ...row, columns }
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
