import {
  BAND_EDGES,
  type BandEdge,
  type LayoutBand,
  type LayoutBody,
  type LayoutCell,
  type LayoutCellRow,
  type LayoutTab,
} from '../models/workspace-layout'

/**
 * Where things are in a layout's body (columns → rows → cells, and the two
 * bands): a row's, a cell's and a tab's location, the parts in order, every
 * id, and the structure key (the body without its view state). Pure reads;
 * the reducers over them are `workspace-layout-ops`.
 */

/** Where a row of cells is: a column's row, or a band. */
export type RowLocation =
  | { kind: 'column'; colIdx: number; rowIdx: number }
  | { kind: 'band'; edge: BandEdge }

/** Where a cell is: in a column's row, or in a band. */
export type CellLocation =
  | { kind: 'column'; colIdx: number; rowIdx: number; cellIdx: number }
  | { kind: 'band'; edge: BandEdge; cellIdx: number }

/** Where a tab is: its cell and its index in that cell's strip. */
export interface TabLocation {
  cell: CellLocation
  cellId: string
  tabIdx: number
}

/** The row (or band) part of a cell's location. */
export function rowLocOf(loc: CellLocation): RowLocation {
  return loc.kind === 'band' ? { kind: 'band', edge: loc.edge } : { kind: 'column', colIdx: loc.colIdx, rowIdx: loc.rowIdx }
}

/** Where the row (a column's row, or a band) with id `rowId` is. */
export function findRow(layout: LayoutBody, rowId: string): RowLocation | null {
  for (const edge of BAND_EDGES) {
    if (layout[edge]?.id === rowId) return { kind: 'band', edge }
  }
  for (let colIdx = 0; colIdx < layout.columns.length; colIdx++) {
    const rows = layout.columns[colIdx]?.rows ?? []
    const rowIdx = rows.findIndex((r) => r.id === rowId)
    if (rowIdx !== -1) return { kind: 'column', colIdx, rowIdx }
  }
  return null
}

export function rowAt(layout: LayoutBody, loc: RowLocation): LayoutCellRow | undefined {
  return loc.kind === 'band' ? layout[loc.edge] : layout.columns[loc.colIdx]?.rows[loc.rowIdx]
}

/** Where the cell with id `cellId` is (in a column's row or in a band). */
export function findCell(layout: LayoutBody, cellId: string): CellLocation | null {
  for (const edge of BAND_EDGES) {
    const cellIdx = layout[edge]?.cells.findIndex((c) => c.id === cellId) ?? -1
    if (cellIdx !== -1) return { kind: 'band', edge, cellIdx }
  }
  for (let colIdx = 0; colIdx < layout.columns.length; colIdx++) {
    const rows = layout.columns[colIdx]?.rows ?? []
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const cellIdx = rows[rowIdx]?.cells.findIndex((c) => c.id === cellId) ?? -1
      if (cellIdx !== -1) return { kind: 'column', colIdx, rowIdx, cellIdx }
    }
  }
  return null
}

export function cellAt(layout: LayoutBody, loc: CellLocation): LayoutCell | undefined {
  return rowAt(layout, rowLocOf(loc))?.cells[loc.cellIdx]
}

/** The row (a column's row, or a band) holding cell `cellId`, if any. */
export function rowOfCell(layout: LayoutBody, cellId: string): LayoutCellRow | undefined {
  const loc = findCell(layout, cellId)
  return loc ? rowAt(layout, rowLocOf(loc)) : undefined
}

/** Every cell, the top band's first, then the columns' rows' cells in order, then the bottom band's. */
export function layoutPanels(layout: LayoutBody): LayoutCell[] {
  const out: LayoutCell[] = []
  if (layout.top) out.push(...layout.top.cells)
  for (const col of layout.columns) for (const row of col.rows) out.push(...row.cells)
  if (layout.bottom) out.push(...layout.bottom.cells)
  return out
}

/** Every row of cells: the top band, the columns' rows in order, the bottom band. */
export function layoutRows(layout: LayoutBody): LayoutCellRow[] {
  const out: LayoutCellRow[] = []
  if (layout.top) out.push(layout.top)
  for (const col of layout.columns) out.push(...col.rows)
  if (layout.bottom) out.push(layout.bottom)
  return out
}

export function findTab(layout: LayoutBody, tabId: string): TabLocation | null {
  for (const cell of layoutPanels(layout)) {
    const tabIdx = cell.tabs.findIndex((t) => t.id === tabId)
    if (tabIdx === -1) continue
    const loc = findCell(layout, cell.id)
    return loc ? { cell: loc, cellId: cell.id, tabIdx } : null
  }
  return null
}

/** The cell holding tab `tabId`, if any. */
export function panelOfTab(layout: LayoutBody, tabId: string): LayoutCell | undefined {
  const loc = findTab(layout, tabId)
  return loc ? cellAt(layout, loc.cell) : undefined
}

/** The tab with id `tabId`, if any. */
export function getTab(layout: LayoutBody, tabId: string): LayoutTab | undefined {
  const loc = findTab(layout, tabId)
  return loc ? cellAt(layout, loc.cell)?.tabs[loc.tabIdx] : undefined
}

/** Every tab, cell by cell (`layoutPanels` order). */
export function layoutTabs(layout: LayoutBody): LayoutTab[] {
  return layoutPanels(layout).flatMap((p) => p.tabs)
}

/** Every column / row / cell / band / tab id in the layout (new ids must not repeat one). */
export function layoutIds(layout: LayoutBody): Set<string> {
  const ids = new Set<string>()
  for (const col of layout.columns) ids.add(col.id)
  for (const row of layoutRows(layout)) ids.add(row.id)
  for (const cell of layoutPanels(layout)) {
    ids.add(cell.id)
    for (const tab of cell.tabs) ids.add(tab.id)
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

/** The structural part of a cell: its id, its layout config and its tabs' config (its width and active tab are view state). */
function cellKey(cell: LayoutCell): unknown {
  return {
    id: cell.id,
    ...(cell.stripShown !== undefined ? { stripShown: cell.stripShown } : {}),
    tabs: cell.tabs.map((tab) => ({ id: tab.id, kind: tab.kind, config: canonical(tab.config) })),
  }
}

/** The structural part of a band: its id and cells (its height and collapsed are view state). */
function bandKey(band: LayoutBand | undefined): unknown {
  if (!band) return null
  return { id: band.id, cells: band.cells.map(cellKey) }
}

/**
 * The structural part of a layout's body — its columns, rows, cells, bands
 * and tabs with their config — without view state (sizes, active tab,
 * collapsed, `viewState`).
 */
export function layoutStructureKey(body: LayoutBody): string {
  return JSON.stringify({
    top: bandKey(body.top),
    columns: body.columns.map((col) => ({
      id: col.id,
      rows: col.rows.map((row) => ({ id: row.id, cells: row.cells.map(cellKey) })),
    })),
    bottom: bandKey(body.bottom),
  })
}

/** True when two layout bodies differ only in view state (i.e. the working copy has no unsaved changes). */
export function layoutStructureEqual(a: LayoutBody, b: LayoutBody): boolean {
  if (a === b) return true
  if (a.columns === b.columns && a.top === b.top && a.bottom === b.bottom) return true
  return layoutStructureKey(a) === layoutStructureKey(b)
}
