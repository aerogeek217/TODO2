import {
  DEFAULT_WEIGHT,
  type LayoutCell,
  type LayoutColumn,
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
 * Structural invariants every reducer keeps: a column always has at least one
 * cell (a column losing its last cell is removed); a cell losing its last tab
 * is removed (cells are only empty when made by `splitCell`); ids are unique
 * across columns, cells and tabs.
 */

/** Mints a fresh id for a new column or cell. */
export type IdGen = () => string

/**
 * Where a tab lands:
 *
 * - `cell` — joins the cell's tab strip at `index` (end when absent) and
 *   becomes its active tab (the cell body's middle zone, or the tab strip).
 * - `cell-edge` — a new cell directly above / below the cell, in its column.
 * - `column-edge` — a new column directly left / right of the column. The
 *   gutter between two columns can be named from either side.
 * - `layout` — a new last column (e.g. the first widget of an empty layout).
 */
export type LayoutDropTarget =
  | { kind: 'cell'; cellId: string; index?: number }
  | { kind: 'cell-edge'; cellId: string; edge: 'top' | 'bottom' }
  | { kind: 'column-edge'; columnId: string; edge: 'left' | 'right' }
  | { kind: 'layout' }

interface TabLocation {
  colIdx: number
  cellIdx: number
  tabIdx: number
}

interface CellLocation {
  colIdx: number
  cellIdx: number
}

export function findCell(layout: WorkspaceLayout, cellId: string): CellLocation | null {
  for (let colIdx = 0; colIdx < layout.columns.length; colIdx++) {
    const cells = layout.columns[colIdx]?.cells ?? []
    const cellIdx = cells.findIndex((c) => c.id === cellId)
    if (cellIdx !== -1) return { colIdx, cellIdx }
  }
  return null
}

export function findTab(layout: WorkspaceLayout, tabId: string): TabLocation | null {
  for (let colIdx = 0; colIdx < layout.columns.length; colIdx++) {
    const cells = layout.columns[colIdx]?.cells ?? []
    for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
      const tabIdx = cells[cellIdx]?.tabs.findIndex((t) => t.id === tabId) ?? -1
      if (tabIdx !== -1) return { colIdx, cellIdx, tabIdx }
    }
  }
  return null
}

/**
 * How many list tabs in `layout` show list `listDefinitionId`, not counting
 * the tabs in `exceptTabIds` (e.g. the ones about to be closed).
 */
export function countListTabs(
  layout: WorkspaceLayout,
  listDefinitionId: number,
  exceptTabIds: ReadonlySet<string> = new Set(),
): number {
  let n = 0
  for (const col of layout.columns) {
    for (const cell of col.cells) {
      for (const tab of cell.tabs) {
        if (tab.kind === 'lens' && tab.config.listDefinitionId === listDefinitionId && !exceptTabIds.has(tab.id)) n++
      }
    }
  }
  return n
}

/** Every column / cell / tab id in the layout. */
export function layoutIds(layout: WorkspaceLayout): Set<string> {
  const ids = new Set<string>()
  for (const col of layout.columns) {
    ids.add(col.id)
    for (const cell of col.cells) {
      ids.add(cell.id)
      for (const tab of cell.tabs) ids.add(tab.id)
    }
  }
  return ids
}

function withColumns<L extends WorkspaceLayout>(layout: L, columns: LayoutColumn[]): L {
  return { ...layout, columns }
}

function replaceAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  const next = arr.slice()
  next[idx] = value
  return next
}

function insertAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  const clamped = Math.max(0, Math.min(idx, arr.length))
  return [...arr.slice(0, clamped), value, ...arr.slice(clamped)]
}

function removeAt<T>(arr: readonly T[], idx: number): T[] {
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)]
}

function isPositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** Replaces one cell; a cell given as `null` is removed (and its column, when that empties). */
function setCell<L extends WorkspaceLayout>(layout: L, loc: CellLocation, cell: LayoutCell | null): L {
  const col = layout.columns[loc.colIdx]
  if (!col) return layout
  if (cell) {
    return withColumns(layout, replaceAt(layout.columns, loc.colIdx, { ...col, cells: replaceAt(col.cells, loc.cellIdx, cell) }))
  }
  const cells = removeAt(col.cells, loc.cellIdx)
  if (cells.length === 0) return withColumns(layout, removeAt(layout.columns, loc.colIdx))
  return withColumns(layout, replaceAt(layout.columns, loc.colIdx, { ...col, cells }))
}

/**
 * Removes a tab. Its cell's active tab moves to the left neighbour (then the
 * right) when it was the active one; a cell left without tabs is removed, and
 * a column left without cells too.
 */
export function extractTab<L extends WorkspaceLayout>(layout: L, tabId: string): { layout: L; tab: LayoutTab | null } {
  const loc = findTab(layout, tabId)
  if (!loc) return { layout, tab: null }
  const cell = layout.columns[loc.colIdx]?.cells[loc.cellIdx]
  const tab = cell?.tabs[loc.tabIdx]
  if (!cell || !tab) return { layout, tab: null }
  const tabs = removeAt(cell.tabs, loc.tabIdx)
  if (tabs.length === 0) return { layout: setCell(layout, loc, null), tab }
  const next: LayoutCell = { ...cell, tabs }
  if (cell.activeTabId === tabId) {
    const fallback = cell.tabs[loc.tabIdx - 1] ?? cell.tabs[loc.tabIdx + 1]
    if (fallback) next.activeTabId = fallback.id
  }
  return { layout: setCell(layout, loc, next), tab }
}

export function closeTab<L extends WorkspaceLayout>(layout: L, tabId: string): L {
  return extractTab(layout, tabId).layout
}

/** Removes a cell with all its tabs (and its column, when that empties). */
export function closeCell<L extends WorkspaceLayout>(layout: L, cellId: string): L {
  const loc = findCell(layout, cellId)
  return loc ? setCell(layout, loc, null) : layout
}

function newCell(id: string, weight: number, tab?: LayoutTab): LayoutCell {
  return tab ? { id, weight, tabs: [tab], activeTabId: tab.id } : { id, weight, tabs: [] }
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

/** A new cell directly above / below the cell at `loc`; the two split that cell's weight evenly. */
function insertCellBeside<L extends WorkspaceLayout>(layout: L, loc: CellLocation, edge: 'top' | 'bottom', makeCell: (weight: number) => LayoutCell): L {
  const col = layout.columns[loc.colIdx]
  const hovered = col?.cells[loc.cellIdx]
  if (!col || !hovered) return layout
  const half = hovered.weight / 2
  const cells = replaceAt(col.cells, loc.cellIdx, { ...hovered, weight: half })
  const at = edge === 'top' ? loc.cellIdx : loc.cellIdx + 1
  return withColumns(layout, replaceAt(layout.columns, loc.colIdx, { ...col, cells: insertAt(cells, at, makeCell(half)) }))
}

/** Places a tab that is not (or no longer) in the layout. `null` when the target doesn't exist. */
function placeTab<L extends WorkspaceLayout>(layout: L, tab: LayoutTab, target: LayoutDropTarget, genId: IdGen): L | null {
  switch (target.kind) {
    case 'cell': {
      const loc = findCell(layout, target.cellId)
      const cell = loc ? layout.columns[loc.colIdx]?.cells[loc.cellIdx] : undefined
      if (!loc || !cell) return null
      const tabs = insertAt(cell.tabs, target.index ?? cell.tabs.length, tab)
      return setCell(layout, loc, { ...cell, tabs, activeTabId: tab.id })
    }
    case 'cell-edge': {
      const loc = findCell(layout, target.cellId)
      if (!loc) return null
      return insertCellBeside(layout, loc, target.edge, (weight) => newCell(genId(), weight, tab))
    }
    case 'column-edge': {
      const colIdx = layout.columns.findIndex((c) => c.id === target.columnId)
      if (colIdx === -1) return null
      const gutter = target.edge === 'left' ? colIdx : colIdx + 1
      return insertColumnAtGutter(layout, gutter, (weight) => ({ id: genId(), weight, cells: [newCell(genId(), DEFAULT_WEIGHT, tab)] }))
    }
    case 'layout':
      return insertColumnAtGutter(layout, layout.columns.length, (weight) => ({ id: genId(), weight, cells: [newCell(genId(), DEFAULT_WEIGHT, tab)] }))
  }
}

/** Adds a new widget tab (its id must be unused in the layout) at `target`. */
export function addTab<L extends WorkspaceLayout>(layout: L, tab: LayoutTab, target: LayoutDropTarget, genId: IdGen): L {
  if (layoutIds(layout).has(tab.id)) return layout
  return placeTab(layout, tab, target, genId) ?? layout
}

/**
 * Whether moving `tabId` to `target` would leave the layout as it is. True
 * when the tab is the only tab of its cell and the target is that cell's own
 * middle or edges, or — when its cell is also the only cell of its column —
 * that column's own edges.
 */
function isNoOpMove(layout: WorkspaceLayout, loc: TabLocation, target: LayoutDropTarget): boolean {
  const col = layout.columns[loc.colIdx]
  const cell = col?.cells[loc.cellIdx]
  if (!col || !cell || cell.tabs.length !== 1) return false
  if (target.kind === 'cell-edge') {
    const t = findCell(layout, target.cellId)
    if (!t || t.colIdx !== loc.colIdx) return false
    const gutter = target.edge === 'top' ? t.cellIdx : t.cellIdx + 1
    return gutter === loc.cellIdx || gutter === loc.cellIdx + 1
  }
  if (target.kind === 'column-edge' || target.kind === 'layout') {
    if (col.cells.length !== 1) return false
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
 * Moves a tab to `target`. Within its own cell (`cell` target) it reorders:
 * `index` is the position among the *other* tabs; without an `index` (the
 * cell's own middle zone) nothing happens. The moved
 * tab becomes its destination cell's active tab. A cell / column the move
 * empties is removed; a move onto a target that the move itself removes, or
 * that leaves everything where it was, returns the layout unchanged.
 */
export function moveTab<L extends WorkspaceLayout>(layout: L, tabId: string, target: LayoutDropTarget, genId: IdGen): L {
  const loc = findTab(layout, tabId)
  if (!loc) return layout
  const srcCell = layout.columns[loc.colIdx]?.cells[loc.cellIdx]
  const tab = srcCell?.tabs[loc.tabIdx]
  if (!srcCell || !tab) return layout

  if (target.kind === 'cell' && target.cellId === srcCell.id) {
    if (target.index === undefined) return layout
    const others = removeAt(srcCell.tabs, loc.tabIdx)
    const at = Math.max(0, Math.min(target.index, others.length))
    if (at === loc.tabIdx && srcCell.activeTabId === tab.id) return layout
    const tabs = insertAt(others, at, tab)
    return setCell(layout, { colIdx: loc.colIdx, cellIdx: loc.cellIdx }, { ...srcCell, tabs, activeTabId: tab.id })
  }
  if (isNoOpMove(layout, loc, target)) return layout

  const { layout: without } = extractTab(layout, tabId)
  return placeTab(without, tab, target, genId) ?? layout
}

/**
 * "Split right" (a new column right of the cell's column) or "Split below"
 * (a new cell under it); either holds one empty cell. Returns the new cell's
 * id, or `null` (layout unchanged) for an unknown cell.
 */
export function splitCell<L extends WorkspaceLayout>(
  layout: L,
  cellId: string,
  direction: 'right' | 'below',
  genId: IdGen,
): { layout: L; cellId: string | null } {
  const loc = findCell(layout, cellId)
  const col = loc ? layout.columns[loc.colIdx] : undefined
  if (!loc || !col) return { layout, cellId: null }
  const id = genId()
  if (direction === 'below') {
    return { layout: insertCellBeside(layout, loc, 'bottom', (weight) => newCell(id, weight)), cellId: id }
  }
  const next = insertColumnAtGutter(layout, loc.colIdx + 1, (weight) => ({ id: genId(), weight, cells: [newCell(id, DEFAULT_WEIGHT)] }))
  return { layout: next, cellId: id }
}

/**
 * Batched resize: sets the weight of every listed column (by id) at once, so
 * a divider drag updates its two neighbours together. Unknown ids and
 * non-positive / non-finite weights are ignored.
 */
export function setColumnWeights<L extends WorkspaceLayout>(layout: L, weightById: Readonly<Record<string, number>>): L {
  let changed = false
  const columns = layout.columns.map((col) => {
    const w = weightById[col.id]
    if (!isPositive(w) || w === col.weight) return col
    changed = true
    return { ...col, weight: w }
  })
  return changed ? withColumns(layout, columns) : layout
}

/** Batched resize of cells (by id, in any columns). Same rules as `setColumnWeights`. */
export function setCellWeights<L extends WorkspaceLayout>(layout: L, weightById: Readonly<Record<string, number>>): L {
  let changed = false
  const columns = layout.columns.map((col) => {
    let colChanged = false
    const cells = col.cells.map((cell) => {
      const w = weightById[cell.id]
      if (!isPositive(w) || w === cell.weight) return cell
      colChanged = true
      return { ...cell, weight: w }
    })
    if (!colChanged) return col
    changed = true
    return { ...col, cells }
  })
  return changed ? withColumns(layout, columns) : layout
}

function updateCell<L extends WorkspaceLayout>(layout: L, cellId: string, fn: (cell: LayoutCell) => LayoutCell): L {
  const loc = findCell(layout, cellId)
  const cell = loc ? layout.columns[loc.colIdx]?.cells[loc.cellIdx] : undefined
  if (!loc || !cell) return layout
  const next = fn(cell)
  return next === cell ? layout : setCell(layout, loc, next)
}

function updateTab<L extends WorkspaceLayout>(layout: L, tabId: string, fn: (tab: LayoutTab) => LayoutTab): L {
  const loc = findTab(layout, tabId)
  const cell = loc ? layout.columns[loc.colIdx]?.cells[loc.cellIdx] : undefined
  const tab = cell?.tabs[loc?.tabIdx ?? -1]
  if (!loc || !cell || !tab) return layout
  const next = fn(tab)
  if (next === tab) return layout
  const tabs = replaceAt(cell.tabs, loc.tabIdx, next)
  const activeTabId = cell.activeTabId === tab.id ? next.id : cell.activeTabId
  return setCell(layout, loc, { ...cell, tabs, ...(activeTabId !== undefined ? { activeTabId } : {}) })
}

/** View state: collapse / expand a cell. */
export function setCellCollapsed<L extends WorkspaceLayout>(layout: L, cellId: string, collapsed: boolean): L {
  return updateCell(layout, cellId, (cell) => {
    if ((cell.collapsed === true) === collapsed) return cell
    if (collapsed) return { ...cell, collapsed: true }
    const { collapsed: _drop, ...rest } = cell
    void _drop
    return rest
  })
}

/** View state: make `tabId` its cell's active tab. */
export function setActiveTab<L extends WorkspaceLayout>(layout: L, tabId: string): L {
  const loc = findTab(layout, tabId)
  const cell = loc ? layout.columns[loc.colIdx]?.cells[loc.cellIdx] : undefined
  if (!cell) return layout
  return updateCell(layout, cell.id, (c) => (c.activeTabId === tabId ? c : { ...c, activeTabId: tabId }))
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

/** Layout config: shallow-patches a tab's `config` — only when the tab is of `kind`. */
export function patchTabConfig<L extends WorkspaceLayout, K extends WidgetKind>(
  layout: L,
  tabId: string,
  kind: K,
  patch: Partial<TabConfigOf<K>>,
): L {
  return updateTab(layout, tabId, (tab) => {
    if (tab.kind !== kind) return tab
    const config = shallowPatch(tab.config as TabConfigOf<K>, patch)
    return config === tab.config ? tab : ({ ...tab, config } as LayoutTab)
  })
}

/** View state: shallow-patches a tab's `viewState` — only when the tab is of `kind`. */
export function patchTabViewState<L extends WorkspaceLayout, K extends WidgetKind>(
  layout: L,
  tabId: string,
  kind: K,
  patch: Partial<TabViewStateOf<K>>,
): L {
  return updateTab(layout, tabId, (tab) => {
    if (tab.kind !== kind) return tab
    const base = (tab.viewState ?? {}) as TabViewStateOf<K>
    const viewState = shallowPatch(base, patch)
    return viewState === base ? tab : ({ ...tab, viewState } as LayoutTab)
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

/** Each weight as its share of the siblings' total, rounded (weights only matter relative to each other). */
function shares(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0)
  return weights.map((w) => (total > 0 ? Math.round((w / total) * 1e6) / 1e6 : 0))
}

/**
 * The saved part of a layout's columns: structure, relative sizes and tab
 * config, without view state (active tab, collapsed, `viewState`). Weights
 * compare as shares of their siblings, so e.g. a column left with one cell
 * keys the same whatever that cell's weight.
 */
export function layoutStructureKey(columns: readonly LayoutColumn[]): string {
  const colShares = shares(columns.map((c) => c.weight))
  return JSON.stringify(columns.map((col, i) => {
    const cellShares = shares(col.cells.map((c) => c.weight))
    return {
      id: col.id,
      weight: colShares[i],
      cells: col.cells.map((cell, j) => ({
        id: cell.id,
        weight: cellShares[j],
        tabs: cell.tabs.map((tab) => ({ id: tab.id, kind: tab.kind, config: canonical(tab.config) })),
      })),
    }
  }))
}

/** True when two layouts differ only in view state (i.e. the working copy has no unsaved changes). */
export function layoutStructureEqual(a: readonly LayoutColumn[], b: readonly LayoutColumn[]): boolean {
  return a === b || layoutStructureKey(a) === layoutStructureKey(b)
}
