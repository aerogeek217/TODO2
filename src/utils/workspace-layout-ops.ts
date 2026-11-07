import {
  BAND_DEFAULT_HEIGHT,
  BAND_EDGES,
  DEFAULT_WEIGHT,
  tabListId,
  type BandEdge,
  type LayoutBand,
  type LayoutBody,
  type LayoutCell,
  type LayoutCellRow,
  type LayoutColumn,
  type LayoutRow,
  type LayoutTab,
  type TabConfigOf,
  type TabViewStateOf,
  type WidgetKind,
  type WorkspaceLayout,
} from '../models/workspace-layout'

/**
 * Pure reducers over a `WorkspaceLayout`. Each returns the **same object**
 * when nothing changes (unknown ids, no-op moves), so callers can skip
 * persisting / re-rendering by reference.
 *
 * A layout is columns → rows → cells, plus the two full-width bands (`top` /
 * `bottom`), each one row of cells. A **cell** (a panel) is what holds a tab
 * strip, in a column's row or in a band; ops that take a cell id work on
 * either. A **row** is a column's row or a band: ops that take a row id
 * (collapse, the cells' widths) work on either too. A band never holds a
 * second row, and a cell never splits again (one level more, no deeper).
 *
 * Structural invariants every reducer keeps: a cell losing its last tab is
 * removed (cells are only empty when made by `splitCell`); a row losing its
 * last cell is removed, and a column losing its last row; a band losing its
 * last cell is removed (its key goes); a removal that leaves a column only
 * collapsed rows expands one, so the column stays filled; ids are unique
 * across columns, rows, cells, bands and tabs.
 */

/** Mints a fresh id for a new column, row, cell or band. */
export type IdGen = () => string

/**
 * Where a tab (or a whole cell's tabs) lands:
 *
 * - `cell` — joins the cell's tab strip at `index` (end when absent); the
 *   (first) moved tab becomes its active tab (the body's middle zone, or the
 *   tab strip). The cell may be a band's.
 * - `cell-edge` — `left` / `right`: a new cell directly beside the cell, in
 *   its row (or band); `top` / `bottom`: a new row directly above / below the
 *   cell's row, in its column (a band's cell has no such edge: a band is one
 *   row).
 * - `row-edge` — a new row directly above / below a column's row (a band
 *   has none).
 * - `column-edge` — a new column directly left / right of the column. The
 *   gutter between two columns can be named from either side.
 * - `layout` — a new last column (e.g. the first widget of an empty layout).
 * - `band` — joins the band's first cell at that edge, as `cell` does.
 * - `new-band` — a new band at that edge (only while there is none).
 */
export type LayoutDropTarget =
  | { kind: 'cell'; cellId: string; index?: number }
  | { kind: 'cell-edge'; cellId: string; edge: 'top' | 'bottom' | 'left' | 'right' }
  | { kind: 'row-edge'; rowId: string; edge: 'top' | 'bottom' }
  | { kind: 'column-edge'; columnId: string; edge: 'left' | 'right' }
  | { kind: 'layout' }
  | { kind: 'band'; edge: BandEdge; index?: number }
  | { kind: 'new-band'; edge: BandEdge }

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
function rowLocOf(loc: CellLocation): RowLocation {
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

/**
 * How many tabs in `layout` show list `listDefinitionId` — its list tabs,
 * and its Eisenhower tabs when it is the Eisenhower's own list
 * (`eisenhowerListId`; `tabListId`) —, not counting the tabs in
 * `exceptTabIds` (e.g. the ones about to be closed).
 */
export function countListTabs(
  layout: LayoutBody,
  listDefinitionId: number,
  eisenhowerListId: number | null,
  exceptTabIds: ReadonlySet<string> = new Set(),
): number {
  let n = 0
  for (const tab of layoutTabs(layout)) {
    if (tabListId(tab, eisenhowerListId) === listDefinitionId && !exceptTabIds.has(tab.id)) n++
  }
  return n
}

/**
 * The ids of the lists a layout itself names: its list tabs' lists and its
 * dashboard tabs' list tiles (an Eisenhower tab's list is the Eisenhower's,
 * not the layout's).
 */
export function layoutListRefs(layout: LayoutBody): Set<number> {
  const ids = new Set<number>()
  for (const tab of layoutTabs(layout)) {
    if (tab.kind === 'lens' && tab.config.listDefinitionId != null) ids.add(tab.config.listDefinitionId)
    else if (tab.kind === 'dashboard') for (const id of tab.config.listTiles) ids.add(id)
  }
  return ids
}

/** `cells` with `fn` applied to each; `cells` itself when no cell changes. */
function mapCells(cells: readonly LayoutCell[], fn: (cell: LayoutCell) => LayoutCell): LayoutCell[] | null {
  const next = cells.map(fn)
  return next.every((c, i) => c === cells[i]) ? null : next
}

/**
 * `layout` with `fn` applied to every cell (in columns and bands); the same
 * object when no cell changes.
 */
function mapLayoutCells<B extends LayoutBody>(layout: B, fn: (cell: LayoutCell) => LayoutCell): B {
  let changed = false
  const columns = layout.columns.map((col) => {
    const rows = col.rows.map((row) => {
      const cells = mapCells(row.cells, fn)
      return cells ? { ...row, cells } : row
    })
    if (rows.every((r, i) => r === col.rows[i])) return col
    return { ...col, rows }
  })
  if (columns.some((c, i) => c !== layout.columns[i])) changed = true
  const bandOf = (band: LayoutBand | undefined): LayoutBand | undefined => {
    if (!band) return band
    const cells = mapCells(band.cells, fn)
    if (!cells) return band
    changed = true
    return { ...band, cells }
  }
  const top = bandOf(layout.top)
  const bottom = bandOf(layout.bottom)
  if (!changed) return layout
  return { ...layout, columns, ...(top ? { top } : {}), ...(bottom ? { bottom } : {}) }
}

/**
 * The layout with the lists it names (`layoutListRefs`) renamed by `ids`
 * (old id → new id; ids it doesn't hold stay). The same object when
 * nothing changes.
 */
export function repointLayoutLists<B extends LayoutBody>(layout: B, ids: ReadonlyMap<number, number>): B {
  if (ids.size === 0) return layout
  const tabOf = (tab: LayoutTab): LayoutTab => {
    if (tab.kind === 'lens') {
      const to = tab.config.listDefinitionId != null ? ids.get(tab.config.listDefinitionId) : undefined
      return to == null ? tab : { ...tab, config: { ...tab.config, listDefinitionId: to } }
    }
    if (tab.kind === 'dashboard' && tab.config.listTiles.some((id) => ids.has(id))) {
      return { ...tab, config: { ...tab.config, listTiles: tab.config.listTiles.map((id) => ids.get(id) ?? id) } }
    }
    return tab
  }
  return mapLayoutCells(layout, (cell) => {
    const tabs = cell.tabs.map(tabOf)
    return tabs.every((t, i) => t === cell.tabs[i]) ? cell : { ...cell, tabs }
  })
}

/**
 * The lists `after` shows where `before` showed other ones at the same tab
 * (matched by tab id; a dashboard's list tiles by position, when the tab
 * has as many): old id → new id, e.g. a layout given its own copies of the
 * lists it shared with another one. `null` when an old id would become two
 * different ones.
 */
export function listIdChanges(before: LayoutBody, after: LayoutBody): Map<number, number> | null {
  const afterTabs = new Map(layoutTabs(after).map((t) => [t.id, t]))
  const changes = new Map<number, number>()
  const note = (from: number | undefined, to: number | undefined): boolean => {
    if (from == null || to == null || from === to) return true
    const known = changes.get(from)
    if (known != null && known !== to) return false
    changes.set(from, to)
    return true
  }
  for (const tab of layoutTabs(before)) {
    const other = afterTabs.get(tab.id)
    if (tab.kind === 'lens' && other?.kind === 'lens') {
      if (!note(tab.config.listDefinitionId, other.config.listDefinitionId)) return null
    } else if (tab.kind === 'dashboard' && other?.kind === 'dashboard' && tab.config.listTiles.length === other.config.listTiles.length) {
      for (const [i, id] of tab.config.listTiles.entries()) if (!note(id, other.config.listTiles[i])) return null
    }
  }
  return changes
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

function withColumns<L extends WorkspaceLayout>(layout: L, columns: LayoutColumn[]): L {
  return { ...layout, columns }
}

/** `layout` with the band at `edge` replaced (`null` removes it: the key goes). */
function withBand<L extends WorkspaceLayout>(layout: L, edge: BandEdge, band: LayoutBand | null): L {
  const next = { ...layout }
  if (band) next[edge] = band
  else delete next[edge]
  return next
}

function replaceAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  const next = arr.slice()
  next[idx] = value
  return next
}

function insertAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  return insertAllAt(arr, idx, [value])
}

function insertAllAt<T>(arr: readonly T[], idx: number, values: readonly T[]): T[] {
  const clamped = Math.max(0, Math.min(idx, arr.length))
  return [...arr.slice(0, clamped), ...values, ...arr.slice(clamped)]
}

function removeAt<T>(arr: readonly T[], idx: number): T[] {
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)]
}

function isPositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** `row` without `collapsed` (expanded). */
function expanded<R extends LayoutCellRow>(row: R): R {
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
function setColumnRow<L extends WorkspaceLayout>(layout: L, colIdx: number, rowIdx: number, row: LayoutRow | null): L {
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
function setRowAt<L extends WorkspaceLayout>(layout: L, loc: RowLocation, row: LayoutCellRow | null): L {
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
function setCellAt<L extends WorkspaceLayout>(layout: L, loc: CellLocation, cell: LayoutCell | null): L {
  const rowLoc = rowLocOf(loc)
  const row = rowAt(layout, rowLoc)
  if (!row?.cells[loc.cellIdx]) return layout
  const cells = cell ? replaceAt(row.cells, loc.cellIdx, cell) : removeAt(row.cells, loc.cellIdx)
  return setRowAt(layout, rowLoc, cells.length === 0 ? null : { ...row, cells })
}

/** The strip part of a cell: what `setStrip` replaces. */
type CellStrip = Pick<LayoutCell, 'tabs' | 'activeTabId'>

function stripOf(c: LayoutCell): CellStrip {
  return { tabs: c.tabs, ...(c.activeTabId !== undefined ? { activeTabId: c.activeTabId } : {}) }
}

/** `c` with its strip replaced by `strip` (an absent `activeTabId` drops that key). */
function withStrip(c: LayoutCell, strip: CellStrip): LayoutCell {
  const { activeTabId: _a, ...rest } = c
  void _a
  return { ...rest, tabs: strip.tabs, ...(strip.activeTabId !== undefined ? { activeTabId: strip.activeTabId } : {}) }
}

/** Replaces one cell's strip (tabs, active tab); `null` removes the cell, as `setCellAt` does. */
function setStrip<L extends WorkspaceLayout>(layout: L, loc: CellLocation, strip: CellStrip | null): L {
  const cell = cellAt(layout, loc)
  if (!cell) return layout
  return setCellAt(layout, loc, strip ? withStrip(cell, strip) : null)
}

/**
 * Removes a tab. Its cell's active tab moves to the left neighbour (then the
 * right) when it was the active one; a cell left without tabs is removed (and
 * a row, column or band left without cells too).
 */
export function extractTab<L extends WorkspaceLayout>(layout: L, tabId: string): { layout: L; tab: LayoutTab | null } {
  const loc = findTab(layout, tabId)
  const cell = loc ? cellAt(layout, loc.cell) : undefined
  const tab = loc ? cell?.tabs[loc.tabIdx] : undefined
  if (!loc || !cell || !tab) return { layout, tab: null }
  const tabs = removeAt(cell.tabs, loc.tabIdx)
  if (tabs.length === 0) return { layout: setStrip(layout, loc.cell, null), tab }
  const next: CellStrip = { ...stripOf(cell), tabs }
  if (cell.activeTabId === tabId) {
    const fallback = cell.tabs[loc.tabIdx - 1] ?? cell.tabs[loc.tabIdx + 1]
    if (fallback) next.activeTabId = fallback.id
  }
  return { layout: setStrip(layout, loc.cell, next), tab }
}

export function closeTab<L extends WorkspaceLayout>(layout: L, tabId: string): L {
  return extractTab(layout, tabId).layout
}

/** Removes a cell — in a column's row or a band — with all its tabs (and its row, column or band, when that empties). */
export function closeCell<L extends WorkspaceLayout>(layout: L, cellId: string): L {
  const loc = findCell(layout, cellId)
  return loc ? setCellAt(layout, loc, null) : layout
}

/** What a new cell carries over from the cell it replaces (a whole-cell move): its layout config. */
type CellConfig = Pick<LayoutCell, 'stripShown'>

function newCell(id: string, weight: number, tabs: readonly LayoutTab[] = [], activeTabId?: string, config: CellConfig = {}): LayoutCell {
  const extra = config.stripShown !== undefined ? { stripShown: config.stripShown } : {}
  const first = tabs[0]
  if (!first) return { id, weight, tabs: [], ...extra }
  const active = activeTabId != null && tabs.some((t) => t.id === activeTabId) ? activeTabId : first.id
  return { id, weight, tabs: [...tabs], activeTabId: active, ...extra }
}

function newRow(id: string, weight: number, cell: LayoutCell): LayoutRow {
  return { id, weight, cells: [cell] }
}

/**
 * Inserts `column` so that it sits at `gutter` (0 = before the first column,
 * `columns.length` = after the last). It takes its width from the columns on
 * either side of that gutter: its weight is half the narrower neighbour's,
 * split evenly off the neighbours, so the total and every other column stay
 * as they were. With no neighbour (empty layout) it gets the default weight.
 */
function insertColumnAtGutter<L extends WorkspaceLayout>(layout: L, gutter: number, makeColumn: (weight: number) => LayoutColumn): L {
  const neighbourIdx = [gutter - 1, gutter].filter((i) => i >= 0 && i < layout.columns.length)
  const neighbourWeights = neighbourIdx.map((i) => layout.columns[i]?.weight ?? DEFAULT_WEIGHT)
  if (neighbourWeights.length === 0) return withColumns(layout, insertAt(layout.columns, gutter, makeColumn(DEFAULT_WEIGHT)))
  const weight = Math.min(...neighbourWeights) / 2
  const share = weight / neighbourWeights.length
  const columns = layout.columns.map((col, i) => (neighbourIdx.includes(i) ? { ...col, weight: col.weight - share } : col))
  return withColumns(layout, insertAt(columns, gutter, makeColumn(weight)))
}

/** A new row directly above / below row `rowIdx` of column `colIdx`; the two split that row's weight evenly. */
function insertRowBeside<L extends WorkspaceLayout>(
  layout: L,
  colIdx: number,
  rowIdx: number,
  edge: 'top' | 'bottom',
  makeRow: (weight: number) => LayoutRow,
): L {
  const col = layout.columns[colIdx]
  const hovered = col?.rows[rowIdx]
  if (!col || !hovered) return layout
  const half = hovered.weight / 2
  const rows = replaceAt(col.rows, rowIdx, { ...hovered, weight: half })
  const at = edge === 'top' ? rowIdx : rowIdx + 1
  return withColumns(layout, replaceAt(layout.columns, colIdx, { ...col, rows: insertAt(rows, at, makeRow(half)) }))
}

/** A new cell directly left / right of the cell at `loc`, in its row; the two split that cell's width evenly. */
function insertCellBeside<L extends WorkspaceLayout>(layout: L, loc: CellLocation, edge: 'left' | 'right', makeCell: (weight: number) => LayoutCell): L {
  const rowLoc = rowLocOf(loc)
  const row = rowAt(layout, rowLoc)
  const hovered = row?.cells[loc.cellIdx]
  if (!row || !hovered) return layout
  const half = hovered.weight / 2
  const cells = replaceAt(row.cells, loc.cellIdx, { ...hovered, weight: half })
  const at = edge === 'left' ? loc.cellIdx : loc.cellIdx + 1
  return setRowAt(layout, rowLoc, { ...row, cells: insertAt(cells, at, makeCell(half)) })
}

/** The column row a row-making target (`cell-edge` top / bottom, `row-edge`) names: its column and index. */
function targetRow(layout: WorkspaceLayout, target: LayoutDropTarget): { colIdx: number; rowIdx: number; edge: 'top' | 'bottom' } | null {
  if (target.kind === 'row-edge') {
    const loc = findRow(layout, target.rowId)
    return loc?.kind === 'column' ? { colIdx: loc.colIdx, rowIdx: loc.rowIdx, edge: target.edge } : null
  }
  if (target.kind === 'cell-edge' && (target.edge === 'top' || target.edge === 'bottom')) {
    const loc = findCell(layout, target.cellId)
    return loc?.kind === 'column' ? { colIdx: loc.colIdx, rowIdx: loc.rowIdx, edge: target.edge } : null
  }
  return null
}

/** The cell a joining target (`cell` / `band`) names, if it exists. */
function joinedCell(layout: WorkspaceLayout, target: LayoutDropTarget): CellLocation | null {
  if (target.kind === 'band') return layout[target.edge]?.cells[0] ? { kind: 'band', edge: target.edge, cellIdx: 0 } : null
  if (target.kind === 'cell') return findCell(layout, target.cellId)
  return null
}

/**
 * Places tabs that are not (or no longer) in the layout, in order. Joining a
 * cell (`cell` / `band`) makes the first of them its active tab, as does a
 * new band; a new cell, row or column shows `activeTabId` (default the
 * first). A new cell takes `config` (a moved cell's own). `null` when the
 * target doesn't exist (or, `new-band`, when that band does; a band's cell's
 * top / bottom edge).
 */
function placeTabs<L extends WorkspaceLayout>(
  layout: L,
  tabs: readonly LayoutTab[],
  target: LayoutDropTarget,
  genId: IdGen,
  activeTabId?: string,
  config: CellConfig = {},
): L | null {
  const first = tabs[0]
  if (!first) return null
  /** A new column holding one row of one cell, at `gutter`. */
  const newColumnAt = (gutter: number) => insertColumnAtGutter(layout, gutter, (weight) => {
    const id = genId()
    const rowId = genId()
    return { id, weight, rows: [newRow(rowId, DEFAULT_WEIGHT, newCell(genId(), DEFAULT_WEIGHT, tabs, activeTabId, config))] }
  })
  switch (target.kind) {
    case 'cell':
    case 'band': {
      const loc = joinedCell(layout, target)
      const cell = loc ? cellAt(layout, loc) : undefined
      if (!loc || !cell) return null
      const at = target.index ?? cell.tabs.length
      return setStrip(layout, loc, { ...stripOf(cell), tabs: insertAllAt(cell.tabs, at, tabs), activeTabId: first.id })
    }
    case 'new-band': {
      if (layout[target.edge]) return null
      const id = genId()
      return withBand(layout, target.edge, { id, height: BAND_DEFAULT_HEIGHT, cells: [newCell(genId(), DEFAULT_WEIGHT, tabs, first.id, config)] })
    }
    case 'cell-edge':
    case 'row-edge': {
      if (target.kind === 'cell-edge' && (target.edge === 'left' || target.edge === 'right')) {
        const loc = findCell(layout, target.cellId)
        if (!loc) return null
        return insertCellBeside(layout, loc, target.edge, (weight) => newCell(genId(), weight, tabs, activeTabId, config))
      }
      const at = targetRow(layout, target)
      if (!at) return null
      return insertRowBeside(layout, at.colIdx, at.rowIdx, at.edge, (weight) => {
        const rowId = genId()
        return newRow(rowId, weight, newCell(genId(), DEFAULT_WEIGHT, tabs, activeTabId, config))
      })
    }
    case 'column-edge': {
      const colIdx = layout.columns.findIndex((c) => c.id === target.columnId)
      if (colIdx === -1) return null
      return newColumnAt(target.edge === 'left' ? colIdx : colIdx + 1)
    }
    case 'layout':
      return newColumnAt(layout.columns.length)
  }
}

/** Adds a new widget tab (its id must be unused in the layout) at `target`. */
export function addTab<L extends WorkspaceLayout>(layout: L, tab: LayoutTab, target: LayoutDropTarget, genId: IdGen): L {
  if (layoutIds(layout).has(tab.id)) return layout
  return placeTabs(layout, [tab], target, genId) ?? layout
}

/** Whether `target` names the cell at `loc` itself (its strip or its body). */
function targetsCell(layout: WorkspaceLayout, loc: CellLocation, target: LayoutDropTarget): boolean {
  const joined = joinedCell(layout, target)
  if (!joined) return false
  return cellAt(layout, joined) === cellAt(layout, loc)
}

/** Whether two cell locations are in the same row (or the same band). */
function sameRow(a: CellLocation, b: CellLocation): boolean {
  if (a.kind === 'band') return b.kind === 'band' && a.edge === b.edge
  return b.kind === 'column' && a.colIdx === b.colIdx && a.rowIdx === b.rowIdx
}

/**
 * Whether placing the whole cell at `loc` on `target` would put it back
 * where it is: its own left / right edges or its neighbours' next to it in
 * its row; when it is its row's only cell, the row gutters next to its row
 * in its column; and when that row is its column's only one too, that
 * column's own edges.
 */
function isNoOpPlacement(layout: WorkspaceLayout, loc: CellLocation, target: LayoutDropTarget): boolean {
  const row = rowAt(layout, rowLocOf(loc))
  if (!row) return false
  if (target.kind === 'cell-edge' && (target.edge === 'left' || target.edge === 'right')) {
    const t = findCell(layout, target.cellId)
    if (!t || !sameRow(t, loc)) return false
    const gutter = target.edge === 'left' ? t.cellIdx : t.cellIdx + 1
    return gutter === loc.cellIdx || gutter === loc.cellIdx + 1
  }
  if (loc.kind !== 'column' || row.cells.length !== 1) return false
  const at = targetRow(layout, target)
  if (at) {
    if (at.colIdx !== loc.colIdx) return false
    const gutter = at.edge === 'top' ? at.rowIdx : at.rowIdx + 1
    return gutter === loc.rowIdx || gutter === loc.rowIdx + 1
  }
  if (target.kind === 'column-edge' || target.kind === 'layout') {
    const col = layout.columns[loc.colIdx]
    if (!col || col.rows.length !== 1) return false
    let gutter = layout.columns.length
    if (target.kind === 'column-edge') {
      const colIdx = layout.columns.findIndex((c) => c.id === target.columnId)
      if (colIdx === -1) return false
      gutter = target.edge === 'left' ? colIdx : colIdx + 1
    }
    return gutter === loc.colIdx || gutter === loc.colIdx + 1
  }
  return false
}

/**
 * Moves a tab to `target`. Within its own cell (`cell` / `band` target) it
 * reorders: `index` is the position among the *other* tabs; without an
 * `index` (the cell's own body) nothing happens. The moved tab becomes its
 * destination cell's active tab. A cell / row / column / band the move
 * empties is removed; a move onto a target that the move itself removes,
 * onto a band edge that already has a band, or that leaves everything where
 * it was, returns the layout unchanged.
 */
export function moveTab<L extends WorkspaceLayout>(layout: L, tabId: string, target: LayoutDropTarget, genId: IdGen): L {
  const loc = findTab(layout, tabId)
  const src = loc ? cellAt(layout, loc.cell) : undefined
  const tab = loc ? src?.tabs[loc.tabIdx] : undefined
  if (!loc || !src || !tab) return layout
  if (target.kind === 'new-band' && layout[target.edge]) return layout

  if (targetsCell(layout, loc.cell, target)) {
    const index = target.kind === 'cell' || target.kind === 'band' ? target.index : undefined
    if (index === undefined) return layout
    const others = removeAt(src.tabs, loc.tabIdx)
    const at = Math.max(0, Math.min(index, others.length))
    if (at === loc.tabIdx && src.activeTabId === tab.id) return layout
    return setStrip(layout, loc.cell, { ...stripOf(src), tabs: insertAt(others, at, tab), activeTabId: tab.id })
  }
  if (src.tabs.length === 1 && isNoOpPlacement(layout, loc.cell, target)) return layout

  const { layout: without } = extractTab(layout, tabId)
  return placeTabs(without, [tab], target, genId) ?? layout
}

/**
 * Moves a whole cell — in a column's row or a band, all its tabs in order —
 * to `target`: into another cell (`cell` / `band`: a merge, at `index` or
 * after its tabs, the first moved tab active), a new band (its first tab
 * active), a new cell beside a cell, a new row, or a new column (these keep
 * the cell's active tab and its layout config). The cell leaves its old
 * place (an emptied row, column or band goes). A drop onto the cell itself,
 * back where it is, or onto a band edge that already has a band returns the
 * layout unchanged.
 */
export function movePanel<L extends WorkspaceLayout>(layout: L, cellId: string, target: LayoutDropTarget, genId: IdGen): L {
  const loc = findCell(layout, cellId)
  const cell = loc ? cellAt(layout, loc) : undefined
  if (!loc || !cell || cell.tabs.length === 0) return layout
  if (target.kind === 'new-band' && layout[target.edge]) return layout
  if (targetsCell(layout, loc, target) || isNoOpPlacement(layout, loc, target)) return layout
  const without = setCellAt(layout, loc, null)
  const config: CellConfig = cell.stripShown !== undefined ? { stripShown: cell.stripShown } : {}
  return placeTabs(without, cell.tabs, target, genId, cell.activeTabId, config) ?? layout
}

/** A band's height (px, rounded). No band there or a bad height → unchanged. */
export function setBandHeight<L extends WorkspaceLayout>(layout: L, edge: BandEdge, height: number): L {
  const band = layout[edge]
  if (!band || !isPositive(height)) return layout
  const rounded = Math.max(1, Math.round(height))
  return rounded === band.height ? layout : withBand(layout, edge, { ...band, height: rounded })
}

/**
 * Where a split puts the new empty cell: `right` — beside the cell, in its
 * row (or band); `below` — a new row under the cell's row; `new-column` — a
 * new column right of the cell's column.
 */
export type SplitDirection = 'right' | 'below' | 'new-column'

/**
 * Splits a cell: a new empty cell `direction` of it (a band's cell splits
 * only `right`). Returns the new cell's id, or `null` (layout unchanged) for
 * an unknown cell or a split a band can't take.
 */
export function splitCell<L extends WorkspaceLayout>(
  layout: L,
  cellId: string,
  direction: SplitDirection,
  genId: IdGen,
): { layout: L; cellId: string | null } {
  const loc = findCell(layout, cellId)
  if (!loc) return { layout, cellId: null }
  if (direction === 'right') {
    const id = genId()
    return { layout: insertCellBeside(layout, loc, 'right', (weight) => newCell(id, weight)), cellId: id }
  }
  if (loc.kind !== 'column') return { layout, cellId: null }
  if (direction === 'below') {
    const rowId = genId()
    const id = genId()
    return { layout: insertRowBeside(layout, loc.colIdx, loc.rowIdx, 'bottom', (weight) => newRow(rowId, weight, newCell(id, DEFAULT_WEIGHT))), cellId: id }
  }
  const colId = genId()
  const rowId = genId()
  const id = genId()
  const next = insertColumnAtGutter(layout, loc.colIdx + 1, (weight) => ({ id: colId, weight, rows: [newRow(rowId, DEFAULT_WEIGHT, newCell(id, DEFAULT_WEIGHT))] }))
  return { layout: next, cellId: id }
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

function updateCellStrip<L extends WorkspaceLayout>(layout: L, cellId: string, fn: (strip: CellStrip) => CellStrip): L {
  const loc = findCell(layout, cellId)
  const cell = loc ? cellAt(layout, loc) : undefined
  if (!loc || !cell) return layout
  const strip = stripOf(cell)
  const next = fn(strip)
  return next === strip ? layout : setStrip(layout, loc, next)
}

function updateTab<L extends WorkspaceLayout>(layout: L, tabId: string, fn: (tab: LayoutTab) => LayoutTab): L {
  const loc = findTab(layout, tabId)
  const cell = loc ? cellAt(layout, loc.cell) : undefined
  const tab = loc ? cell?.tabs[loc.tabIdx] : undefined
  if (!loc || !cell || !tab) return layout
  const next = fn(tab)
  if (next === tab) return layout
  const strip = stripOf(cell)
  const tabs = replaceAt(cell.tabs, loc.tabIdx, next)
  return setStrip(layout, loc.cell, { ...strip, tabs, ...(cell.activeTabId === tab.id ? { activeTabId: next.id } : {}) })
}

/** View state: collapse / expand a row of cells (a column's row or a band, by id). */
export function setRowCollapsed<L extends WorkspaceLayout>(layout: L, rowId: string, collapsed: boolean): L {
  const loc = findRow(layout, rowId)
  const row = loc ? rowAt(layout, loc) : undefined
  if (!loc || !row || (row.collapsed === true) === collapsed) return layout
  return setRowAt(layout, loc, collapsed ? { ...row, collapsed: true } : expanded(row))
}

/**
 * Layout config: whether a cell shows its tab strip (`null` = by its
 * widget: the key goes). The same layout when unchanged.
 */
export function setCellStripShown<L extends WorkspaceLayout>(layout: L, cellId: string, shown: boolean | null): L {
  const loc = findCell(layout, cellId)
  const cell = loc ? cellAt(layout, loc) : undefined
  if (!loc || !cell || (cell.stripShown ?? null) === shown) return layout
  const { stripShown: _drop, ...rest } = cell
  void _drop
  return setCellAt(layout, loc, shown == null ? rest : { ...rest, stripShown: shown })
}

/** View state: make `tabId` its cell's active tab. */
export function setActiveTab<L extends WorkspaceLayout>(layout: L, tabId: string): L {
  const loc = findTab(layout, tabId)
  if (!loc) return layout
  return updateCellStrip(layout, loc.cellId, (s) => (s.activeTabId === tabId ? s : { ...s, activeTabId: tabId }))
}

/** View state: the page the phone shows (`null` = the first; the key goes). The same layout when unchanged. */
export function setLayoutActiveColumn<L extends WorkspaceLayout>(layout: L, pageId: string | null): L {
  if ((layout.activeColumnId ?? null) === pageId) return layout
  const next = { ...layout }
  if (pageId == null) delete next.activeColumnId
  else next.activeColumnId = pageId
  return next
}

/** The layout's hue (`null` = none, the app accent; the key goes). The same layout when unchanged. */
export function setLayoutHue<L extends WorkspaceLayout>(layout: L, hue: string | null): L {
  if ((layout.hue ?? null) === hue) return layout
  const next = { ...layout }
  if (hue == null) delete next.hue
  else next.hue = hue
  return next
}

/**
 * Replaces a tab in place (e.g. "Change widget"). `next.id` must be the same
 * id or one unused in the layout; the cell's active tab follows it.
 */
export function replaceTab<L extends WorkspaceLayout>(layout: L, tabId: string, next: LayoutTab): L {
  if (next.id !== tabId && layoutIds(layout).has(next.id)) return layout
  return updateTab(layout, tabId, () => next)
}

function shallowPatch<T extends object>(base: T, patch: Partial<T>): T {
  let changed = false
  for (const [k, v] of Object.entries(patch)) {
    if ((base as Record<string, unknown>)[k] !== v) changed = true
  }
  return changed ? { ...base, ...patch } : base
}

/**
 * Layout config: shallow-patches a tab's `config` — only when the tab is of
 * `kind`. A key patched to `undefined` is removed (e.g. an Eisenhower tab
 * back on all tasks).
 */
export function patchTabConfig<L extends WorkspaceLayout, K extends WidgetKind>(
  layout: L,
  tabId: string,
  kind: K,
  patch: Partial<TabConfigOf<K>>,
): L {
  return updateTab(layout, tabId, (tab) => {
    if (tab.kind !== kind) return tab
    const patched = shallowPatch(tab.config as TabConfigOf<K>, patch)
    if (patched === tab.config) return tab
    const config = Object.fromEntries(Object.entries(patched).filter(([, v]) => v !== undefined))
    return { ...tab, config } as LayoutTab
  })
}

/**
 * View state: shallow-patches a tab's `viewState` — only when the tab is of
 * `kind`. A key patched to `undefined` is removed (back to its default).
 */
export function patchTabViewState<L extends WorkspaceLayout, K extends WidgetKind>(
  layout: L,
  tabId: string,
  kind: K,
  patch: Partial<TabViewStateOf<K>>,
): L {
  return updateTab(layout, tabId, (tab) => {
    if (tab.kind !== kind) return tab
    const base = (tab.viewState ?? {}) as TabViewStateOf<K>
    const patched = shallowPatch(base, patch)
    if (patched === base) return tab
    const viewState = Object.fromEntries(Object.entries(patched).filter(([, v]) => v !== undefined))
    return { ...tab, viewState } as LayoutTab
  })
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
