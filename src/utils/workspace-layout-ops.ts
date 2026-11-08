import {
  BAND_DEFAULT_HEIGHT,
  DEFAULT_WEIGHT,
  type BandEdge,
  type LayoutCell,
  type LayoutColumn,
  type LayoutRow,
  type LayoutTab,
  type TabConfigOf,
  type TabViewStateOf,
  type WidgetKind,
  type WorkspaceLayout,
} from '../models/workspace-layout'
import { isFitRow } from './workspace-rows'
import { cellAt, type CellLocation, findCell, findRow, findTab, layoutIds, rowAt, rowLocOf } from './workspace-layout-queries'
import { expanded, insertAllAt, insertAt, removeAt, replaceAt, setCellAt, setRowAt, withBand, withColumns } from './workspace-layout-edit'

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

/**
 * A new row directly above / below row `rowIdx` of column `colIdx`; the two
 * split that row's weight evenly — unless the new row fits its content
 * (`isFitRow`, a Number's): it takes no share of the column's height, so the
 * row keeps its weight (the new one's half counts only once it stops fitting).
 */
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
  const row = makeRow(half)
  const rows = isFitRow(row) ? col.rows : replaceAt(col.rows, rowIdx, { ...hovered, weight: half })
  const at = edge === 'top' ? rowIdx : rowIdx + 1
  return withColumns(layout, replaceAt(layout.columns, colIdx, { ...col, rows: insertAt(rows, at, row) }))
}

/**
 * After tabs joined the cell at `loc`: when that cell was empty and alone in
 * its column row (a Split ▸ Below's new row, which took half of the row it
 * split) and the row now fits its content, its weight goes back to the
 * nearest row above that doesn't fit (else below) — a fit row takes no share
 * of the column's height, so the split leaves the other rows as they were.
 * Its own weight stays, counted only once it stops fitting.
 */
function handBackFitRowWeight<L extends WorkspaceLayout>(layout: L, loc: CellLocation, wasLoneEmpty: boolean): L {
  if (!wasLoneEmpty || loc.kind !== 'column') return layout
  const col = layout.columns[loc.colIdx]
  const row = col?.rows[loc.rowIdx]
  if (!col || !row || !isFitRow(row)) return layout
  const weighted = (i: number) => {
    const r = col.rows[i]
    return r != null && !isFitRow(r)
  }
  let heir = -1
  for (let i = loc.rowIdx - 1; i >= 0 && heir === -1; i--) if (weighted(i)) heir = i
  for (let i = loc.rowIdx + 1; i < col.rows.length && heir === -1; i++) if (weighted(i)) heir = i
  const heirRow = col.rows[heir]
  if (!heirRow) return layout
  const rows = replaceAt(col.rows, heir, { ...heirRow, weight: heirRow.weight + row.weight })
  return withColumns(layout, replaceAt(layout.columns, loc.colIdx, { ...col, rows }))
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
      const loneEmpty = cell.tabs.length === 0 && rowAt(layout, rowLocOf(loc))?.cells.length === 1
      const joined = setStrip(layout, loc, { ...stripOf(cell), tabs: insertAllAt(cell.tabs, at, tabs), activeTabId: first.id })
      return handBackFitRowWeight(joined, loc, loneEmpty)
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
