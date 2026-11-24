import type { LayoutBody, LayoutCell, LayoutTab } from '../models/workspace-layout'

/**
 * Where things are in a layout's body (its table: tracks and cells): a
 * tab's cell, every cell and tab in order, every id, and the structure key
 * (the body without its view state). Pure reads; the grid's own queries are
 * `workspace-grid`, the reducers `workspace-layout-ops`.
 */

/** Where a tab is: its cell and its index in that cell's strip. */
export interface TabLocation {
  cellId: string
  /** The cell's index in `body.cells`. */
  cellIdx: number
  tabIdx: number
}

export function findTab(layout: LayoutBody, tabId: string): TabLocation | null {
  for (let cellIdx = 0; cellIdx < layout.cells.length; cellIdx++) {
    const cell = layout.cells[cellIdx]
    const tabIdx = cell?.tabs.findIndex((t) => t.id === tabId) ?? -1
    if (cell && tabIdx !== -1) return { cellId: cell.id, cellIdx, tabIdx }
  }
  return null
}

/** The cell holding tab `tabId`, if any. */
export function panelOfTab(layout: LayoutBody, tabId: string): LayoutCell | undefined {
  const loc = findTab(layout, tabId)
  return loc ? layout.cells[loc.cellIdx] : undefined
}

/** The tab with id `tabId`, if any. */
export function getTab(layout: LayoutBody, tabId: string): LayoutTab | undefined {
  const loc = findTab(layout, tabId)
  return loc ? layout.cells[loc.cellIdx]?.tabs[loc.tabIdx] : undefined
}

/** Every tab, cell by cell. */
export function layoutTabs(layout: LayoutBody): LayoutTab[] {
  return layout.cells.flatMap((p) => p.tabs)
}

/** Every track / cell / tab id in the layout, and its Numbers widgets' items' (new ids must not repeat one). */
export function layoutIds(layout: LayoutBody): Set<string> {
  const ids = new Set<string>()
  for (const track of layout.grid.columns) ids.add(track.id)
  for (const track of layout.grid.rows) ids.add(track.id)
  for (const cell of layout.cells) {
    ids.add(cell.id)
    for (const tab of cell.tabs) {
      ids.add(tab.id)
      if (tab.kind === 'numbers') for (const item of tab.config.items) ids.add(item.id)
    }
  }
  return ids
}

/** Recursively key-sorted copy with `undefined` values dropped. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) {
      const val = (v as Record<string, unknown>)[k]
      if (val !== undefined) out[k] = canonical(val)
    }
    return out
  }
  return v
}

/** The structural part of a cell: its id, its area and its tabs' config, name and icon (its active tab is view state). */
function cellKey(cell: LayoutCell): unknown {
  const { col, row, colSpan, rowSpan } = cell.area
  return {
    id: cell.id,
    area: [col, row, colSpan, rowSpan],
    tabs: cell.tabs.map((tab) => canonical({ id: tab.id, kind: tab.kind, config: tab.config, name: tab.name, icon: tab.icon })),
  }
}

/**
 * The structural part of a layout's body — its tracks' ids, its cells'
 * areas and its tabs with their config — without view state (the tracks'
 * sizes and collapse, the active tabs, `viewState`).
 */
export function layoutStructureKey(body: LayoutBody): string {
  return JSON.stringify({
    columns: body.grid.columns.map((t) => t.id),
    rows: body.grid.rows.map((t) => t.id),
    cells: body.cells.map(cellKey),
  })
}

/** The structural part of a layout's body without its tracks' ids: how many tracks, and the cells (`layoutStructureKey` less the ids). */
function arrangementKey(body: LayoutBody): string {
  return JSON.stringify({
    columns: body.grid.columns.length,
    rows: body.grid.rows.length,
    cells: body.cells.map(cellKey),
  })
}

/**
 * Whether two bodies are the same arrangement whatever their tracks' ids:
 * as many tracks on each axis, the same cells in the same areas with the
 * same tabs (view state aside).
 */
export function sameArrangement(a: LayoutBody, b: LayoutBody): boolean {
  return a === b || arrangementKey(a) === arrangementKey(b)
}

/** Whether two layout bodies are the same, view state included (the tracks' sizes and collapse, active tabs, tabs' view state). */
export function layoutBodyEqual(a: LayoutBody, b: LayoutBody): boolean {
  if (a === b || (a.grid === b.grid && a.cells === b.cells)) return true
  return JSON.stringify(canonical({ grid: a.grid, cells: a.cells })) === JSON.stringify(canonical({ grid: b.grid, cells: b.cells }))
}

/** True when two layout bodies differ only in view state (i.e. the working copy has no unsaved changes). */
export function layoutStructureEqual(a: LayoutBody, b: LayoutBody): boolean {
  if (a === b) return true
  if (a.grid === b.grid && a.cells === b.cells) return true
  return layoutStructureKey(a) === layoutStructureKey(b)
}
