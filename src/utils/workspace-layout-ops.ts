import {
  BAND_DEFAULT_HEIGHT,
  BAND_EDGES,
  DEFAULT_WEIGHT,
  tabListId,
  type BandEdge,
  type LayoutBand,
  type LayoutBody,
  type LayoutCell,
  type LayoutColumn,
  type LayoutPanel,
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
 * A **panel** is what holds a tab strip: a cell of a column, or one of the
 * two full-width bands (`top` / `bottom`). Ops that take a panel id work on
 * either; a band never splits, has no weight, and is only ever one panel.
 *
 * Structural invariants every reducer keeps: a column always has at least one
 * cell (a column losing its last cell is removed); a cell losing its last tab
 * is removed (cells are only empty when made by `splitCell`); a band losing
 * its last tab is removed (its key goes); ids are unique across columns,
 * cells, bands and tabs.
 */

/** Mints a fresh id for a new column, cell or band. */
export type IdGen = () => string

/**
 * Where a tab (or a whole panel's tabs) lands:
 *
 * - `cell` — joins the panel's tab strip at `index` (end when absent); the
 *   (first) moved tab becomes its active tab (the body's middle zone, or the
 *   tab strip). `cellId` may name a band too.
 * - `cell-edge` — a new cell directly above / below the cell, in its column.
 * - `column-edge` — a new column directly left / right of the column. The
 *   gutter between two columns can be named from either side.
 * - `layout` — a new last column (e.g. the first widget of an empty layout).
 * - `band` — joins the band at that edge, as `cell` does (its body or strip).
 * - `new-band` — a new band at that edge (only while there is none).
 */
export type LayoutDropTarget =
  | { kind: 'cell'; cellId: string; index?: number }
  | { kind: 'cell-edge'; cellId: string; edge: 'top' | 'bottom' }
  | { kind: 'column-edge'; columnId: string; edge: 'left' | 'right' }
  | { kind: 'layout' }
  | { kind: 'band'; edge: BandEdge; index?: number }
  | { kind: 'new-band'; edge: BandEdge }

/** Where a panel is: a cell of a column, or a band. */
export type PanelLocation =
  | { kind: 'cell'; colIdx: number; cellIdx: number }
  | { kind: 'band'; edge: BandEdge }

interface CellLocation {
  colIdx: number
  cellIdx: number
}

/** Where a tab is: its panel and its index in that panel's strip. */
export interface TabLocation {
  panel: PanelLocation
  panelId: string
  tabIdx: number
}

export function findCell(layout: WorkspaceLayout, cellId: string): CellLocation | null {
  for (let colIdx = 0; colIdx < layout.columns.length; colIdx++) {
    const cells = layout.columns[colIdx]?.cells ?? []
    const cellIdx = cells.findIndex((c) => c.id === cellId)
    if (cellIdx !== -1) return { colIdx, cellIdx }
  }
  return null
}

/** Where the panel (cell or band) with id `panelId` is. */
export function findPanel(layout: WorkspaceLayout, panelId: string): PanelLocation | null {
  for (const edge of BAND_EDGES) {
    if (layout[edge]?.id === panelId) return { kind: 'band', edge }
  }
  const loc = findCell(layout, panelId)
  return loc ? { kind: 'cell', ...loc } : null
}

export function panelAt(layout: WorkspaceLayout, loc: PanelLocation): LayoutPanel | undefined {
  return loc.kind === 'band' ? layout[loc.edge] : layout.columns[loc.colIdx]?.cells[loc.cellIdx]
}

/** The panel with id `panelId`, if any. */
export function getPanel(layout: WorkspaceLayout, panelId: string): LayoutPanel | undefined {
  const loc = findPanel(layout, panelId)
  return loc ? panelAt(layout, loc) : undefined
}

/** Every panel, top band first, then the columns' cells in order, then the bottom band. */
export function layoutPanels(layout: LayoutBody): LayoutPanel[] {
  const out: LayoutPanel[] = []
  if (layout.top) out.push(layout.top)
  for (const col of layout.columns) out.push(...col.cells)
  if (layout.bottom) out.push(layout.bottom)
  return out
}

export function findTab(layout: WorkspaceLayout, tabId: string): TabLocation | null {
  for (const edge of BAND_EDGES) {
    const band = layout[edge]
    const tabIdx = band?.tabs.findIndex((t) => t.id === tabId) ?? -1
    if (band && tabIdx !== -1) return { panel: { kind: 'band', edge }, panelId: band.id, tabIdx }
  }
  for (let colIdx = 0; colIdx < layout.columns.length; colIdx++) {
    const cells = layout.columns[colIdx]?.cells ?? []
    for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
      const cell = cells[cellIdx]
      const tabIdx = cell?.tabs.findIndex((t) => t.id === tabId) ?? -1
      if (cell && tabIdx !== -1) return { panel: { kind: 'cell', colIdx, cellIdx }, panelId: cell.id, tabIdx }
    }
  }
  return null
}

/** The panel holding tab `tabId`, if any. */
export function panelOfTab(layout: WorkspaceLayout, tabId: string): LayoutPanel | undefined {
  const loc = findTab(layout, tabId)
  return loc ? panelAt(layout, loc.panel) : undefined
}

/** The tab with id `tabId`, if any. */
export function getTab(layout: WorkspaceLayout, tabId: string): LayoutTab | undefined {
  const loc = findTab(layout, tabId)
  return loc ? panelAt(layout, loc.panel)?.tabs[loc.tabIdx] : undefined
}

/** Every tab, panel by panel (`layoutPanels` order). */
export function layoutTabs(layout: LayoutBody): LayoutTab[] {
  return layoutPanels(layout).flatMap((p) => p.tabs)
}

/**
 * How many tabs in `layout` show list `listDefinitionId` (list tabs and
 * Eisenhower tabs on it — `tabListId`), not counting the tabs in
 * `exceptTabIds` (e.g. the ones about to be closed).
 */
export function countListTabs(
  layout: LayoutBody,
  listDefinitionId: number,
  exceptTabIds: ReadonlySet<string> = new Set(),
): number {
  let n = 0
  for (const tab of layoutTabs(layout)) {
    if (tabListId(tab) === listDefinitionId && !exceptTabIds.has(tab.id)) n++
  }
  return n
}

/** Every column / cell / band / tab id in the layout (new ids must not repeat one). */
export function layoutIds(layout: LayoutBody): Set<string> {
  const ids = new Set<string>()
  for (const col of layout.columns) ids.add(col.id)
  for (const panel of layoutPanels(layout)) {
    ids.add(panel.id)
    for (const tab of panel.tabs) ids.add(tab.id)
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

/** The strip part of a panel: what `setPanel` replaces. */
type PanelStrip = Pick<LayoutPanel, 'tabs' | 'activeTabId' | 'collapsed'>

function stripOf(p: LayoutPanel): PanelStrip {
  return {
    tabs: p.tabs,
    ...(p.activeTabId !== undefined ? { activeTabId: p.activeTabId } : {}),
    ...(p.collapsed !== undefined ? { collapsed: p.collapsed } : {}),
  }
}

/** `p` with its strip replaced by `strip` (absent `activeTabId` / `collapsed` drop those keys). */
function withStrip<P extends LayoutPanel>(p: P, strip: PanelStrip): P {
  const { activeTabId: _a, collapsed: _c, ...rest } = p
  void _a
  void _c
  return {
    ...rest,
    tabs: strip.tabs,
    ...(strip.activeTabId !== undefined ? { activeTabId: strip.activeTabId } : {}),
    ...(strip.collapsed !== undefined ? { collapsed: strip.collapsed } : {}),
  } as P
}

/**
 * Replaces one panel's strip (tabs, active tab, collapsed); `null` removes
 * the panel — a cell as `setCell` does, a band's key goes.
 */
function setPanel<L extends WorkspaceLayout>(layout: L, loc: PanelLocation, strip: PanelStrip | null): L {
  if (loc.kind === 'band') {
    const band = layout[loc.edge]
    if (!band) return layout
    return withBand(layout, loc.edge, strip ? withStrip(band, strip) : null)
  }
  const cell = layout.columns[loc.colIdx]?.cells[loc.cellIdx]
  if (!cell) return layout
  return setCell(layout, loc, strip ? withStrip(cell, strip) : null)
}

/**
 * Removes a tab. Its panel's active tab moves to the left neighbour (then the
 * right) when it was the active one; a cell left without tabs is removed (and
 * a column left without cells too), as is a band left without tabs.
 */
export function extractTab<L extends WorkspaceLayout>(layout: L, tabId: string): { layout: L; tab: LayoutTab | null } {
  const loc = findTab(layout, tabId)
  const panel = loc ? panelAt(layout, loc.panel) : undefined
  const tab = loc ? panel?.tabs[loc.tabIdx] : undefined
  if (!loc || !panel || !tab) return { layout, tab: null }
  const tabs = removeAt(panel.tabs, loc.tabIdx)
  if (tabs.length === 0) return { layout: setPanel(layout, loc.panel, null), tab }
  const next: PanelStrip = { ...stripOf(panel), tabs }
  if (panel.activeTabId === tabId) {
    const fallback = panel.tabs[loc.tabIdx - 1] ?? panel.tabs[loc.tabIdx + 1]
    if (fallback) next.activeTabId = fallback.id
  }
  return { layout: setPanel(layout, loc.panel, next), tab }
}

export function closeTab<L extends WorkspaceLayout>(layout: L, tabId: string): L {
  return extractTab(layout, tabId).layout
}

/** Removes a panel — a cell (and its column, when that empties) or a band — with all its tabs. */
export function closeCell<L extends WorkspaceLayout>(layout: L, panelId: string): L {
  const loc = findPanel(layout, panelId)
  return loc ? setPanel(layout, loc, null) : layout
}

function newCell(id: string, weight: number, tabs: readonly LayoutTab[] = [], activeTabId?: string): LayoutCell {
  const first = tabs[0]
  if (!first) return { id, weight, tabs: [] }
  const active = activeTabId != null && tabs.some((t) => t.id === activeTabId) ? activeTabId : first.id
  return { id, weight, tabs: [...tabs], activeTabId: active }
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

/** The panel a joining target (`cell` / `band`) names, if it exists. */
function joinedPanel(layout: WorkspaceLayout, target: LayoutDropTarget): PanelLocation | null {
  if (target.kind === 'band') return layout[target.edge] ? { kind: 'band', edge: target.edge } : null
  if (target.kind === 'cell') return findPanel(layout, target.cellId)
  return null
}

/**
 * Places tabs that are not (or no longer) in the layout, in order. Joining a
 * panel (`cell` / `band`) makes the first of them its active tab, as does a
 * new band; a new cell or column shows `activeTabId` (default the first).
 * `null` when the target doesn't exist (or, `new-band`, when that band does).
 */
function placeTabs<L extends WorkspaceLayout>(
  layout: L,
  tabs: readonly LayoutTab[],
  target: LayoutDropTarget,
  genId: IdGen,
  activeTabId?: string,
): L | null {
  const first = tabs[0]
  if (!first) return null
  switch (target.kind) {
    case 'cell':
    case 'band': {
      const loc = joinedPanel(layout, target)
      const panel = loc ? panelAt(layout, loc) : undefined
      if (!loc || !panel) return null
      const at = target.index ?? panel.tabs.length
      return setPanel(layout, loc, { ...stripOf(panel), tabs: insertAllAt(panel.tabs, at, tabs), activeTabId: first.id })
    }
    case 'new-band':
      if (layout[target.edge]) return null
      return withBand(layout, target.edge, { id: genId(), height: BAND_DEFAULT_HEIGHT, tabs: [...tabs], activeTabId: first.id })
    case 'cell-edge': {
      const loc = findCell(layout, target.cellId)
      if (!loc) return null
      return insertCellBeside(layout, loc, target.edge, (weight) => newCell(genId(), weight, tabs, activeTabId))
    }
    case 'column-edge': {
      const colIdx = layout.columns.findIndex((c) => c.id === target.columnId)
      if (colIdx === -1) return null
      const gutter = target.edge === 'left' ? colIdx : colIdx + 1
      return insertColumnAtGutter(layout, gutter, (weight) => ({ id: genId(), weight, cells: [newCell(genId(), DEFAULT_WEIGHT, tabs, activeTabId)] }))
    }
    case 'layout':
      return insertColumnAtGutter(layout, layout.columns.length, (weight) => ({ id: genId(), weight, cells: [newCell(genId(), DEFAULT_WEIGHT, tabs, activeTabId)] }))
  }
}

/** Adds a new widget tab (its id must be unused in the layout) at `target`. */
export function addTab<L extends WorkspaceLayout>(layout: L, tab: LayoutTab, target: LayoutDropTarget, genId: IdGen): L {
  if (layoutIds(layout).has(tab.id)) return layout
  return placeTabs(layout, [tab], target, genId) ?? layout
}

/** Whether `target` names the panel at `loc` itself (its strip or its body). */
function targetsPanel(layout: WorkspaceLayout, loc: PanelLocation, target: LayoutDropTarget): boolean {
  const joined = joinedPanel(layout, target)
  if (!joined) return false
  return panelAt(layout, joined) === panelAt(layout, loc)
}

/**
 * Whether placing the whole cell at `loc` on `target` would put it back
 * where it is: its own edges or the gutters next to it in its column, or —
 * when it is the only cell of its column — that column's own edges.
 */
function isNoOpPlacement(layout: WorkspaceLayout, loc: PanelLocation, target: LayoutDropTarget): boolean {
  if (loc.kind !== 'cell') return false
  const col = layout.columns[loc.colIdx]
  if (!col) return false
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
 * Moves a tab to `target`. Within its own panel (`cell` / `band` target) it
 * reorders: `index` is the position among the *other* tabs; without an
 * `index` (the panel's own body) nothing happens. The moved tab becomes its
 * destination panel's active tab. A cell / column / band the move empties is
 * removed; a move onto a target that the move itself removes, onto a band
 * edge that already has a band, or that leaves everything where it was,
 * returns the layout unchanged.
 */
export function moveTab<L extends WorkspaceLayout>(layout: L, tabId: string, target: LayoutDropTarget, genId: IdGen): L {
  const loc = findTab(layout, tabId)
  const src = loc ? panelAt(layout, loc.panel) : undefined
  const tab = loc ? src?.tabs[loc.tabIdx] : undefined
  if (!loc || !src || !tab) return layout
  if (target.kind === 'new-band' && layout[target.edge]) return layout

  if (targetsPanel(layout, loc.panel, target)) {
    const index = target.kind === 'cell' || target.kind === 'band' ? target.index : undefined
    if (index === undefined) return layout
    const others = removeAt(src.tabs, loc.tabIdx)
    const at = Math.max(0, Math.min(index, others.length))
    if (at === loc.tabIdx && src.activeTabId === tab.id) return layout
    return setPanel(layout, loc.panel, { ...stripOf(src), tabs: insertAt(others, at, tab), activeTabId: tab.id })
  }
  if (src.tabs.length === 1 && isNoOpPlacement(layout, loc.panel, target)) return layout

  const { layout: without } = extractTab(layout, tabId)
  return placeTabs(without, [tab], target, genId) ?? layout
}

/**
 * Moves a whole panel — a cell or a band, all its tabs in order — to
 * `target`: into another panel (`cell` / `band`: a merge, at `index` or
 * after its tabs, the first moved tab active), a new band (its first tab
 * active), a new cell above / below a cell, or a new column (these keep the
 * panel's active tab, expanded). The panel leaves its old place (an emptied
 * column goes). A drop onto the panel itself, back where it is, or onto a
 * band edge that already has a band returns the layout unchanged.
 */
export function movePanel<L extends WorkspaceLayout>(layout: L, panelId: string, target: LayoutDropTarget, genId: IdGen): L {
  const loc = findPanel(layout, panelId)
  const panel = loc ? panelAt(layout, loc) : undefined
  if (!loc || !panel || panel.tabs.length === 0) return layout
  if (target.kind === 'new-band' && layout[target.edge]) return layout
  if (targetsPanel(layout, loc, target) || isNoOpPlacement(layout, loc, target)) return layout
  const without = setPanel(layout, loc, null)
  return placeTabs(without, panel.tabs, target, genId, panel.activeTabId) ?? layout
}

/** Layout structure: a band's height (px, rounded). No band there or a bad height → unchanged. */
export function setBandHeight<L extends WorkspaceLayout>(layout: L, edge: BandEdge, height: number): L {
  const band = layout[edge]
  if (!band || !isPositive(height)) return layout
  const rounded = Math.max(1, Math.round(height))
  return rounded === band.height ? layout : withBand(layout, edge, { ...band, height: rounded })
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

function updatePanelStrip<L extends WorkspaceLayout>(layout: L, panelId: string, fn: (strip: PanelStrip) => PanelStrip): L {
  const loc = findPanel(layout, panelId)
  const panel = loc ? panelAt(layout, loc) : undefined
  if (!loc || !panel) return layout
  const strip = stripOf(panel)
  const next = fn(strip)
  return next === strip ? layout : setPanel(layout, loc, next)
}

function updateTab<L extends WorkspaceLayout>(layout: L, tabId: string, fn: (tab: LayoutTab) => LayoutTab): L {
  const loc = findTab(layout, tabId)
  const panel = loc ? panelAt(layout, loc.panel) : undefined
  const tab = loc ? panel?.tabs[loc.tabIdx] : undefined
  if (!loc || !panel || !tab) return layout
  const next = fn(tab)
  if (next === tab) return layout
  const strip = stripOf(panel)
  const tabs = replaceAt(panel.tabs, loc.tabIdx, next)
  return setPanel(layout, loc.panel, { ...strip, tabs, ...(panel.activeTabId === tab.id ? { activeTabId: next.id } : {}) })
}

/** View state: collapse / expand a panel (a cell or a band, by id). */
export function setCellCollapsed<L extends WorkspaceLayout>(layout: L, panelId: string, collapsed: boolean): L {
  return updatePanelStrip(layout, panelId, (strip) => {
    if ((strip.collapsed === true) === collapsed) return strip
    if (collapsed) return { ...strip, collapsed: true }
    const { collapsed: _drop, ...rest } = strip
    void _drop
    return rest
  })
}

/** View state: make `tabId` its panel's active tab. */
export function setActiveTab<L extends WorkspaceLayout>(layout: L, tabId: string): L {
  const loc = findTab(layout, tabId)
  if (!loc) return layout
  return updatePanelStrip(layout, loc.panelId, (s) => (s.activeTabId === tabId ? s : { ...s, activeTabId: tabId }))
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

/** Each weight as its share of the siblings' total, rounded (weights only matter relative to each other). */
function shares(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0)
  return weights.map((w) => (total > 0 ? Math.round((w / total) * 1e6) / 1e6 : 0))
}

/** The saved part of a band: id, height and tab config (its active tab / collapsed are view state). */
function bandKey(band: LayoutBand | undefined): unknown {
  if (!band) return null
  return {
    id: band.id,
    height: Math.round(band.height),
    tabs: band.tabs.map((tab) => ({ id: tab.id, kind: tab.kind, config: canonical(tab.config) })),
  }
}

/**
 * The saved part of a layout's body: structure, relative sizes, band
 * heights and tab config, without view state (active tab, collapsed,
 * `viewState`). Weights compare as shares of their siblings, so e.g. a
 * column left with one cell keys the same whatever that cell's weight.
 */
export function layoutStructureKey(body: LayoutBody): string {
  const { columns } = body
  const colShares = shares(columns.map((c) => c.weight))
  return JSON.stringify({
    top: bandKey(body.top),
    columns: columns.map((col, i) => {
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
    }),
    bottom: bandKey(body.bottom),
  })
}

/** True when two layout bodies differ only in view state (i.e. the working copy has no unsaved changes). */
export function layoutStructureEqual(a: LayoutBody, b: LayoutBody): boolean {
  if (a === b) return true
  if (a.columns === b.columns && a.top === b.top && a.bottom === b.bottom) return true
  return layoutStructureKey(a) === layoutStructureKey(b)
}
