import {
  DEFAULT_WEIGHT,
  tabOwnsName,
  type GridAxis,
  type GridTrack,
  type LayoutBody,
  type LayoutCell,
  type LayoutTab,
  type TabConfigOf,
  type TabViewStateOf,
  type WidgetKind,
  type WorkspaceLayout,
} from '../models/workspace-layout'
import {
  cellById,
  crossAxis,
  expandOrphanRows,
  neighbours,
  normalizeGrid,
  rectOf,
  SIDES,
  sideAxis,
  spanOf,
  stretchCells,
  unionArea,
  wholeEdgeNeighbour,
  withSpan,
  isWholeLine,
  type EdgeStretch,
  type Side,
} from './workspace-grid'
import { findTab, layoutIds, sameArrangement } from './workspace-layout-queries'
import { sameIcon, type IconValue } from '../models/icon'
import { insertAllAt, insertAt, removeAt, replaceAt, setCell, withCells, withTracks } from './workspace-layout-edit'
import { cellMinHeightPx, cellMinWidthPx, isFitTrack } from './workspace-rows'
import { trackSizing } from './workspace-table'

/**
 * Pure reducers over a layout's table (`LayoutBody`: tracks and cells).
 * Each returns the **same object** when nothing changes (unknown ids,
 * no-op moves), so callers can skip persisting / re-rendering by reference
 * — and `workspace-drop.dropChangesLayout` can tell a drop that does
 * nothing.
 *
 * Every structural op ends with `normalizeGrid`: the result's cells tile
 * the grid exactly, every grid line is some cell's edge, and the cells are
 * in reading order. Ids are unique across tracks, cells and tabs.
 *
 * A cell losing its last tab (closed, or moved away) closes by the absorb
 * rule (`closeCell`): its space goes to a neighbour sharing its whole edge
 * — left, above, right, below, the first there is —, else to the
 * neighbours along a side that together cover that whole edge, or, with
 * none (a pinwheel's centre), it stays as an empty cell.
 */

/** Mints a fresh id for a new track or cell. */
export type IdGen = () => string

/**
 * Where a tab (or a whole cell's tabs) lands:
 *
 * - `cell` — joins the cell's tab strip at `index` (end when absent); the
 *   (first) moved tab becomes its active tab. An empty cell takes them.
 * - `split` — a new cell on `side` of the cell, taking half of it
 *   (`splitCell`).
 * - `insert` — a new row / column at the layout's `edge`, full width /
 *   height (`insertTrack`).
 * - `layout` — the first cell of an empty layout; else a new column at the
 *   layout's right.
 */
export type LayoutDropTarget =
  | { kind: 'cell'; cellId: string; index?: number }
  | { kind: 'split'; cellId: string; side: Side }
  | { kind: 'insert'; edge: Side }
  | { kind: 'layout' }

/** The strip part of a cell: what `withStrip` replaces. */
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

/** A strip of `tabs` showing `activeTabId` (default: the first; none for no tabs). */
function stripWith(tabs: readonly LayoutTab[], activeTabId?: string): CellStrip {
  const first = tabs[0]
  if (!first) return { tabs: [] }
  const active = activeTabId != null && tabs.some((t) => t.id === activeTabId) ? activeTabId : first.id
  return { tabs: [...tabs], activeTabId: active }
}

/** A track half of `track`'s size (its weight or px), with `id` — never its `fitPx` (a fit row's height). */
function halfTrack(track: GridTrack, id: string, share = 0.5): GridTrack {
  const half: GridTrack = { id }
  if (track.px != null) half.px = Math.max(1, Math.round(track.px * share))
  else half.weight = (track.weight ?? DEFAULT_WEIGHT) * share
  if (track.collapsed) half.collapsed = true
  return half
}

/**
 * Splits track `t` of `axis` in two at `share` of its size: the first part
 * keeps its id, the second takes `id`; every cell crossing it spans both,
 * every cell after it shifts by one.
 */
function splitTrack<L extends LayoutBody>(layout: L, axis: GridAxis, t: number, share: number, id: string): L {
  const track = layout.grid[axis][t]
  if (!track) return layout
  const first = halfTrack(track, track.id, share)
  const second = halfTrack(track, id, 1 - share)
  const tracks = [...layout.grid[axis].slice(0, t), first, second, ...layout.grid[axis].slice(t + 1)]
  const cells = layout.cells.map((c) => {
    const [start, end] = spanOf(c.area, axis)
    if (end <= t) return c
    const s = start > t ? start + 1 : start
    return { ...c, area: withSpan(c.area, axis, s, end + 1) }
  })
  return withCells(withTracks(layout, axis, tracks), cells)
}

/**
 * The cells along `side` of `cell` that together cover that whole edge —
 * the first starting where it starts, the last ending where it ends, none
 * sticking out past either end — each grown across `cell` (its area
 * extended to the far side of it); `null` when they don't.
 */
function sideTakers(layout: LayoutBody, cell: LayoutCell, side: Side): LayoutCell[] | null {
  const along = neighbours(layout, cell.id, side)
  const first = along[0]
  const last = along.at(-1)
  if (!first || !last) return null
  const cross = crossAxis(sideAxis(side))
  const [start, end] = spanOf(cell.area, cross)
  const inside = along.every((c) => {
    const [s, e] = spanOf(c.area, cross)
    return s >= start && e <= end
  })
  if (!inside || spanOf(first.area, cross)[0] !== start || spanOf(last.area, cross)[1] !== end) return null
  const axis = sideAxis(side)
  const [c0, c1] = spanOf(cell.area, axis)
  return along.map((c) => {
    const [s, e] = spanOf(c.area, axis)
    return { ...c, area: side === 'left' || side === 'top' ? withSpan(c.area, axis, s, c1) : withSpan(c.area, axis, c0, e) }
  })
}

/**
 * Removes a cell's tabs and gives its space away: to the neighbour sharing
 * its whole edge — left, above, right, below, the first there is — which
 * grows over it; with none, to the neighbours along a side that together
 * cover that whole edge (`sideTakers`, the sides in the same order), which
 * all grow across it; with none of those either (the centre of a pinwheel),
 * the cell stays as an empty cell (no tabs). The same layout for an unknown
 * cell, or an empty one with no taker. A collapsed row the close leaves
 * with no filled cell lying only in it expands (`expandOrphanRows`, as
 * `normalizeGrid` does it).
 */
export function closeCell<L extends LayoutBody>(layout: L, cellId: string): L {
  const cell = cellById(layout, cellId)
  if (!cell) return layout
  for (const side of SIDES) {
    const taker = wholeEdgeNeighbour(layout, cellId, side)
    const area = taker ? unionArea(taker.area, cell.area) : null
    if (taker && area) return normalizeGrid(setCell(setCell(layout, taker.id, { ...taker, area }), cellId, null))
  }
  for (const side of SIDES) {
    const takers = sideTakers(layout, cell, side)
    if (!takers) continue
    const grown = takers.reduce<L>((next, c) => setCell(next, c.id, c), layout)
    return normalizeGrid(setCell(grown, cellId, null))
  }
  if (cell.tabs.length === 0) return layout
  return expandOrphanRows(setCell(layout, cellId, withStrip(cell, { tabs: [] })))
}

/**
 * Removes a tab. Its cell's active tab moves to the left neighbour (then the
 * right) when it was the active one; a cell left without tabs closes
 * (`closeCell`).
 */
export function extractTab<L extends LayoutBody>(layout: L, tabId: string): { layout: L; tab: LayoutTab | null } {
  const loc = findTab(layout, tabId)
  const cell = loc ? layout.cells[loc.cellIdx] : undefined
  const tab = loc ? cell?.tabs[loc.tabIdx] : undefined
  if (!loc || !cell || !tab) return { layout, tab: null }
  const tabs = removeAt(cell.tabs, loc.tabIdx)
  if (tabs.length === 0) return { layout: closeCell(layout, cell.id), tab }
  const next: CellStrip = { ...stripOf(cell), tabs }
  if (cell.activeTabId === tabId) {
    const fallback = cell.tabs[loc.tabIdx - 1] ?? cell.tabs[loc.tabIdx + 1]
    if (fallback) next.activeTabId = fallback.id
  }
  return { layout: setCell(layout, cell.id, withStrip(cell, next)), tab }
}

export function closeTab<L extends LayoutBody>(layout: L, tabId: string): L {
  return extractTab(layout, tabId).layout
}

/**
 * Splits a cell: a new empty cell on `side` of it, taking half of it. A
 * cell spanning an even number of tracks that way splits on its middle
 * line; otherwise its middle track splits in two (the cells crossing that
 * track span both halves). Returns the new cell's id, or `null` (layout
 * unchanged) for an unknown cell.
 */
export function splitCell<L extends LayoutBody>(
  layout: L,
  cellId: string,
  side: Side,
  genId: IdGen,
): { layout: L; cellId: string | null } {
  const cell = cellById(layout, cellId)
  if (!cell) return { layout, cellId: null }
  const axis = sideAxis(side)
  const [start, end] = spanOf(cell.area, axis)
  const span = end - start
  let next = layout
  let mid = start + span / 2
  if (span % 2 === 1) {
    const t = start + (span - 1) / 2
    next = splitTrack(next, axis, t, 0.5, genId())
    mid = t + 1
  }
  const grown = cellById(next, cellId)
  if (!grown) return { layout, cellId: null }
  const [s, e] = spanOf(grown.area, axis)
  const id = genId()
  const before = side === 'left' || side === 'top'
  const kept = { ...grown, area: before ? withSpan(grown.area, axis, mid, e) : withSpan(grown.area, axis, s, mid) }
  const added: LayoutCell = { id, area: before ? withSpan(grown.area, axis, s, mid) : withSpan(grown.area, axis, mid, e), tabs: [] }
  const withKept = setCell(next, cellId, kept)
  next = withCells(withKept, [...withKept.cells, added])
  return { layout: normalizeGrid(expandedFor(next, added)), cellId: id }
}

/**
 * `layout` with the row tracks under `cell` expanded when every one of them
 * is collapsed: a new (empty) cell never comes out collapsed — it would
 * show only a header, and an empty cell has no Expand. A split's other half
 * keeps its collapse when it lies in other tracks (a split below / above);
 * beside it in the same row, the row expands (collapse is the row's).
 */
function expandedFor<L extends LayoutBody>(layout: L, cell: LayoutCell): L {
  const [start, end] = spanOf(cell.area, 'rows')
  const rows = layout.grid.rows.slice(start, end)
  if (rows.length === 0 || !rows.every((t) => t.collapsed === true)) return layout
  return rows.reduce<L>((next, t) => setTrackCollapsed(next, t.id, false), layout)
}

/**
 * A new track at the layout's `edge` (a row at the top / bottom, a column
 * at the left / right) holding one new empty cell across the whole layout.
 * It takes half the size of the nearest weighted track on that axis (which
 * keeps the other half); with none, the default weight. In an empty layout,
 * the first cell (one column, one row). Returns the new cell's id.
 */
export function insertTrack<L extends LayoutBody>(layout: L, edge: Side, genId: IdGen): { layout: L; cellId: string } {
  if (layout.cells.length === 0) {
    const id = genId()
    const colId = genId()
    const rowId = genId()
    const cell: LayoutCell = { id, area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] }
    return { layout: { ...layout, grid: { columns: [{ id: colId, weight: DEFAULT_WEIGHT }], rows: [{ id: rowId, weight: DEFAULT_WEIGHT }] }, cells: [cell] }, cellId: id }
  }
  const axis = sideAxis(edge)
  const atStart = edge === 'left' || edge === 'top'
  const tracks = layout.grid[axis]
  const order = tracks.map((_, i) => i)
  if (!atStart) order.reverse()
  const heirIdx = order.find((i) => tracks[i]?.px == null)
  const heir = heirIdx != null ? tracks[heirIdx] : undefined
  const trackId = genId()
  let resized = tracks
  let weight = DEFAULT_WEIGHT
  if (heir && heirIdx != null) {
    weight = (heir.weight ?? DEFAULT_WEIGHT) / 2
    resized = replaceAt(tracks, heirIdx, { ...heir, weight })
  }
  const newTrack: GridTrack = { id: trackId, weight }
  const at = atStart ? 0 : tracks.length
  const shifted = atStart
    ? layout.cells.map((c) => {
        const [s, e] = spanOf(c.area, axis)
        return { ...c, area: withSpan(c.area, axis, s + 1, e + 1) }
      })
    : layout.cells
  const crossCount = layout.grid[crossAxis(axis)].length
  const id = genId()
  const area = axis === 'columns'
    ? { col: at, row: 0, colSpan: 1, rowSpan: crossCount }
    : { col: 0, row: at, colSpan: crossCount, rowSpan: 1 }
  const added: LayoutCell = { id, area, tabs: [] }
  const next = withCells(withTracks(layout, axis, insertAt(resized, at, newTrack)), [...shifted, added])
  return { layout: normalizeGrid(expandedFor(next, added)), cellId: id }
}

/**
 * Merges cell `bId` into cell `aId` when the two make a rectangle: `a`
 * grows over `b`, `b`'s tabs join `a`'s strip after its own (`a`'s active
 * tab stays; an empty `a` shows `b`'s), and `b` goes. The same layout when
 * they don't make a rectangle (or either is unknown).
 */
export function mergeCells<L extends LayoutBody>(layout: L, aId: string, bId: string): L {
  const a = cellById(layout, aId)
  const b = cellById(layout, bId)
  if (!a || !b || a === b) return layout
  const area = unionArea(a.area, b.area)
  if (!area) return layout
  const tabs = [...a.tabs, ...b.tabs]
  const strip = stripWith(tabs, a.tabs.length > 0 ? (a.activeTabId ?? a.tabs[0]?.id) : b.activeTabId)
  return normalizeGrid(setCell(setCell(layout, aId, { ...withStrip(a, strip), area }), bId, null))
}

/** `layout` with the empty cell `cellId` filled with `tabs`, showing `activeTabId` (default the first). */
function fillCell<L extends LayoutBody>(layout: L, cellId: string, tabs: readonly LayoutTab[], activeTabId?: string): L {
  const cell = cellById(layout, cellId)
  if (!cell) return layout
  return setCell(layout, cellId, withStrip(cell, stripWith(tabs, activeTabId)))
}

/**
 * Places tabs that are not (or no longer) in the layout, in order. Joining a
 * cell makes the first of them its active tab; a new cell (split, insert,
 * layout) shows `activeTabId` (default the first). `null` when the target
 * doesn't exist.
 */
function placeTabs<L extends LayoutBody>(
  layout: L,
  tabs: readonly LayoutTab[],
  target: LayoutDropTarget,
  genId: IdGen,
  activeTabId?: string,
): L | null {
  const first = tabs[0]
  if (!first) return null
  switch (target.kind) {
    case 'cell': {
      const cell = cellById(layout, target.cellId)
      if (!cell) return null
      const at = target.index ?? cell.tabs.length
      return setCell(layout, cell.id, withStrip(cell, { tabs: insertAllAt(cell.tabs, at, tabs), activeTabId: first.id }))
    }
    case 'split': {
      const split = splitCell(layout, target.cellId, target.side, genId)
      return split.cellId == null ? null : fillCell(split.layout, split.cellId, tabs, activeTabId)
    }
    case 'insert': {
      const inserted = insertTrack(layout, target.edge, genId)
      return fillCell(inserted.layout, inserted.cellId, tabs, activeTabId)
    }
    case 'layout': {
      const inserted = insertTrack(layout, 'right', genId)
      return fillCell(inserted.layout, inserted.cellId, tabs, activeTabId)
    }
  }
}

/** Adds a new widget tab (its id must be unused in the layout) at `target`. */
export function addTab<L extends LayoutBody>(layout: L, tab: LayoutTab, target: LayoutDropTarget, genId: IdGen): L {
  if (layoutIds(layout).has(tab.id)) return layout
  return placeTabs(layout, [tab], target, genId) ?? layout
}

/**
 * The arrangement of a body: every cell's rectangle and tab ids, by cell id
 * (`rename` maps a new cell's id to the one it stands for). Two bodies with
 * the same arrangement show the same cells in the same places, whatever
 * their track ids and sizes.
 */
function arrangement(body: LayoutBody, rename: ReadonlyMap<string, string> = new Map()): string {
  return JSON.stringify({
    c: body.grid.columns.length,
    r: body.grid.rows.length,
    cells: body.cells
      .map((c) => [rename.get(c.id) ?? c.id, c.area.col, c.area.row, c.area.colSpan, c.area.rowSpan, c.tabs.map((t) => t.id).join(',')] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  })
}

/**
 * `next` unless a whole cell's move put it back where it was: the cell now
 * holding `tabId` (new, standing for `oldCellId`) in the same place among
 * the same cells — then `layout`.
 */
function unlessBackInPlace<L extends LayoutBody>(layout: L, next: L, tabId: string, oldCellId: string): L {
  const moved = findTab(next, tabId)
  if (!moved || moved.cellId === oldCellId) return next
  return arrangement(next, new Map([[moved.cellId, oldCellId]])) === arrangement(layout) ? layout : next
}

/**
 * Moves a tab to `target`. Within its own cell (a `cell` target) it
 * reorders: `index` is the position among the *other* tabs; without an
 * `index` nothing happens. The moved tab becomes its destination cell's
 * active tab. A cell the move empties closes (`closeCell`). A move onto its
 * own cell's side when it is that cell's only tab, onto a cell the move
 * itself removes, or that puts everything back where it was, returns the
 * layout unchanged.
 */
export function moveTab<L extends LayoutBody>(layout: L, tabId: string, target: LayoutDropTarget, genId: IdGen): L {
  const loc = findTab(layout, tabId)
  const src = loc ? layout.cells[loc.cellIdx] : undefined
  const tab = loc ? src?.tabs[loc.tabIdx] : undefined
  if (!loc || !src || !tab) return layout

  if (target.kind === 'cell' && target.cellId === src.id) {
    const index = target.index
    if (index === undefined) return layout
    const others = removeAt(src.tabs, loc.tabIdx)
    const at = Math.max(0, Math.min(index, others.length))
    if (at === loc.tabIdx && src.activeTabId === tab.id) return layout
    return setCell(layout, src.id, withStrip(src, { tabs: insertAt(others, at, tab), activeTabId: tab.id }))
  }
  const alone = src.tabs.length === 1
  if (alone && target.kind === 'split' && target.cellId === src.id) return layout
  if (alone) {
    const next = relocate(layout, src.id, (l) => placeTabs(l, [tab], target, genId))
    return next ? unlessBackInPlace(layout, next, tab.id, src.id) : layout
  }
  const { layout: without } = extractTab(layout, tabId)
  return placeTabs(without, [tab], target, genId) ?? layout
}

/**
 * A whole cell's content placed elsewhere (`place`) and its old place
 * closed. Closing first lets a neighbour take its space before the content
 * lands (it may land in that neighbour); when no neighbour can, placing
 * first gives the new cell the chance (an insert beside it, a split next to
 * it) — whichever leaves no empty cell behind, closing first when both or
 * neither do. `null` when the target is gone.
 */
function relocate<L extends LayoutBody>(layout: L, srcId: string, place: (layout: L) => L | null): L | null {
  const src = cellById(layout, srcId)
  if (!src) return null
  const closed = closeCell(layout, srcId)
  const closeFirst = place(closed)
  if (closeFirst && !cellById(closeFirst, srcId)) return closeFirst
  const emptied = setCell(layout, srcId, withStrip(src, { tabs: [] }))
  const placed = place(emptied)
  const placeFirst = placed ? closeCell(placed, srcId) : null
  if (placeFirst && !cellById(placeFirst, srcId)) return placeFirst
  return closeFirst
}

/**
 * Moves a whole cell — all its tabs in order — to `target`: into another
 * cell (`cell`: a merge of strips, at `index` or after its tabs, the first
 * moved tab active), or a new cell from a split or an insert (keeping its
 * active tab). Its old place closes (`closeCell`, by `relocate`: a
 * neighbour or the new cell takes it, or it stays as an empty cell). A drop onto the cell itself (its strip or a
 * side), or back where it is, returns the layout unchanged; so does an
 * empty cell.
 */
export function movePanel<L extends LayoutBody>(layout: L, cellId: string, target: LayoutDropTarget, genId: IdGen): L {
  const cell = cellById(layout, cellId)
  const first = cell?.tabs[0]
  if (!cell || !first) return layout
  if ((target.kind === 'cell' || target.kind === 'split') && target.cellId === cellId) return layout
  const next = relocate(layout, cellId, (l) => placeTabs(l, cell.tabs, target, genId, cell.activeTabId))
  return next ? unlessBackInPlace(layout, next, first.id, cellId) : layout
}

// ── Dividers ────────────────────────────────────────────────────────────────

/** How far (px) a divider drag reaches to snap onto another line. */
export const EDGE_SNAP_PX = 8

export interface MoveEdgeOptions {
  /** Each track's size (px) along the stretch's axis, as measured when the drag started. */
  sizes: readonly number[]
  /** Snap onto another line within this many px (default `EDGE_SNAP_PX`). */
  snapPx?: number
  /**
   * A whole line snaps back onto its own place too (within `snapPx`: no
   * change) — a crossing handle's line holds still while the drag runs
   * along the other one.
   */
  snapHome?: boolean
  /**
   * The smallest size (px) a cell may take along the axis; default 120px
   * wide (72px for a glance cell, `cellMinWidthPx`), `CELL_MIN_PX` high (64px
   * for a glance cell, 58px for a cell of one Number — `cellMinHeightPx`).
   */
  minPx?: (cell: LayoutCell, axis: GridAxis) => number
}

function defaultMinPx(cell: LayoutCell, axis: GridAxis): number {
  return axis === 'columns' ? cellMinWidthPx(cell) : cellMinHeightPx(cell)
}

/** A track resized to `px` of `total` px that it and its pair share (weights kept proportional). */
function resizedPair(a: GridTrack, b: GridTrack, sizeA: number, sizeB: number): [GridTrack, GridTrack] {
  if (a.px == null && b.px == null) {
    const total = (a.weight ?? DEFAULT_WEIGHT) + (b.weight ?? DEFAULT_WEIGHT)
    const wa = sizeA + sizeB > 0 ? (total * sizeA) / (sizeA + sizeB) : total / 2
    return [{ ...a, weight: wa }, { ...b, weight: total - wa }]
  }
  return [
    a.px != null ? { ...a, px: Math.max(1, Math.round(sizeA)) } : a,
    b.px != null ? { ...b, px: Math.max(1, Math.round(sizeB)) } : b,
  ]
}

/**
 * Track `i` of `axis` as `resizedPair` takes it, and how to put the result
 * back: a Numbers-only row (`isFitTrack`, no px, not collapsed) as a fixed
 * track of its height (`fitPx`, else its drawn `size`), the result's px
 * going back as its `fitPx` — a divider beside it gives the row a height of
 * its own, its weight and every other field kept; any other track as it is.
 */
function pairTrack(layout: LayoutBody, axis: GridAxis, i: number, size: number | undefined): { track: GridTrack; back: (t: GridTrack) => GridTrack } | undefined {
  const track = layout.grid[axis][i]
  if (!track) return undefined
  const asIs = { track, back: (t: GridTrack) => t }
  if (axis !== 'rows' || track.px != null || track.collapsed === true || !isFitTrack(layout, i)) return asIs
  const height = track.fitPx ?? (size != null ? Math.max(1, Math.round(size)) : undefined)
  if (height == null) return asIs
  return {
    track: { id: track.id, px: height },
    back: (t) => (t.px === track.fitPx ? track : { ...track, fitPx: t.px ?? height }),
  }
}

/**
 * `tracks` (the axis's tracks after an edit) with weighted track `i`'s
 * weight set so it draws `size` px while every other weighted track keeps
 * the size it had (`sizes`, measured before the edit) — the space a fixed
 * track (a `px` track, a fit row's `fitPx`, a fit row's content) gave or
 * took all lands in track `i`, so no other line moves (J14). The grid
 * shares the free space by weight (`workspace-table.trackTemplate`), so the
 * others keep their sizes when `i`'s weight is to theirs as `size` is to
 * their summed size. Which tracks share the space is read from `layout`
 * (`trackSizing`, the fixed / fit / collapsed ones don't); when `i` isn't
 * one of them, or no other is, `tracks` as they are. The other weighted
 * tracks are assumed drawn by their weights (none held at its minimum),
 * which is what a measured size of them gives back.
 */
function weightedTo(layout: LayoutBody, axis: GridAxis, tracks: GridTrack[], i: number, size: number, sizes: readonly number[]): GridTrack[] {
  const track = tracks[i]
  if (!track || trackSizing(layout, axis, i).kind !== 'weighted' || !(size > 0)) return tracks
  let weights = 0
  let px = 0
  for (let j = 0; j < tracks.length; j++) {
    const s = j === i ? null : trackSizing(layout, axis, j)
    if (s?.kind !== 'weighted') continue
    weights += s.weight
    px += Math.max(0, sizes[j] ?? 0)
  }
  if (!(weights > 0) || !(px > 0)) return tracks
  return replaceAt(tracks, i, { ...track, weight: (weights * size) / px })
}

/**
 * Weighted row track `i` re-weighted to draw `size` px, every other
 * weighted row keeping its size in `sizes` (`weightedTo`) — after a fit
 * row beside it changed height (a double-click clearing its `fitPx`), so
 * only the line between them moves. The same layout when there is nothing
 * to re-weight.
 */
export function withRowDrawnAt<L extends LayoutBody>(layout: L, i: number, size: number, sizes: readonly number[]): L {
  const tracks = layout.grid.rows
  if (sizes.length !== tracks.length) return layout
  const next = weightedTo(layout, 'rows', tracks, i, size, sizes)
  return next === tracks ? layout : withTracks(layout, 'rows', next)
}

/** Where a stretch's drag lands: its clamped, snapped position and what it means (`edgeTarget`). */
interface EdgeTarget {
  /** Each line's position (px) at the drag's start. */
  pos: number[]
  /** The position the stretch moves to (px). */
  target: number
  /** The line it snapped onto, if any. */
  snapped: number | null
  /** The stretch holds every cell edge on its line: moving it is moving the line. */
  whole: boolean
  beforeIds: Set<string>
  afterIds: Set<string>
}

/**
 * Where dragging `stretch` by `delta` px lands: clamped so every cell on
 * either side keeps its minimum (one already under it, the size it has),
 * then snapped onto the nearest line within
 * `snapPx` — any line of the axis, one only other columns' (rows') cells
 * lie on too; a stretch that is part of its line snaps back onto its own
 * line as well, and so does a whole line with `snapHome`. `null` when the
 * stretch isn't one or the sizes don't match.
 */
function edgeTarget(layout: LayoutBody, stretch: EdgeStretch, delta: number, opts: MoveEdgeOptions): EdgeTarget | null {
  const { axis, line } = stretch
  const tracks = layout.grid[axis]
  const { sizes, snapPx = EDGE_SNAP_PX, minPx = defaultMinPx, snapHome = false } = opts
  if (line < 1 || line >= tracks.length || sizes.length !== tracks.length || !Number.isFinite(delta)) return null
  const { before, after } = stretchCells(layout, stretch)
  if (before.length === 0 || after.length === 0) return null
  const pos = [0]
  for (const s of sizes) pos.push((pos.at(-1) ?? 0) + Math.max(0, s))
  const at = (i: number) => pos[i] ?? 0
  const least = Math.max(...before.map((c) => at(spanOf(c.area, axis)[0]) + minPx(c, axis)))
  const most = Math.min(...after.map((c) => at(spanOf(c.area, axis)[1]) - minPx(c, axis)))
  if (least > most) return null
  // A cell already under its minimum (a fit row drawn a fraction short of
  // it, a fixed track set low) keeps the size it has: the clamp holds the
  // line where it is, and never moves it against the drag (cr34 W3).
  const lo = Math.min(at(line), least)
  const hi = Math.max(at(line), most)
  let target = Math.max(lo, Math.min(hi, at(line) + delta))
  const beforeIds = new Set(before.map((c) => c.id))
  const afterIds = new Set(after.map((c) => c.id))
  // The stretch is all its line holds (no other cell's edge lies on it):
  // moving it is moving the line.
  const whole = isWholeLine(layout, stretch) || layout.cells.every((c) => {
    const [s, e] = spanOf(c.area, axis)
    return (s !== line && e !== line) || beforeIds.has(c.id) || afterIds.has(c.id)
  })

  // Snap onto the nearest line within reach (a part line: its own too).
  let snapped: number | null = null
  let best = snapPx
  for (let j = 0; j < pos.length; j++) {
    if (j === line && whole && !snapHome) continue
    const d = Math.abs(at(j) - target)
    if (d <= best && at(j) >= lo && at(j) <= hi) {
      best = d
      snapped = j
    }
  }
  if (snapped != null) target = at(snapped)
  return { pos, target, snapped, whole, beforeIds, afterIds }
}

/** The line a drag of `stretch` by `delta` px snaps onto (`moveEdge`'s snap: its own line too, for part of a line or with `snapHome`), if any. */
export function edgeSnap(layout: LayoutBody, stretch: EdgeStretch, delta: number, opts: MoveEdgeOptions): number | null {
  return edgeTarget(layout, stretch, delta, opts)?.snapped ?? null
}

/**
 * The line a drag of `stretch` by `delta` px holds on, for the guide drawn
 * along it (`edgeSnap`); `null` when it snaps onto none, or rests on its own
 * line without having moved.
 */
export function edgeSnapLine(layout: LayoutBody, stretch: EdgeStretch, delta: number, opts: MoveEdgeOptions): number | null {
  const snapped = edgeSnap(layout, stretch, delta, opts)
  return snapped === stretch.line && Math.abs(delta) < 1 ? null : snapped
}

/**
 * Drags a stretch of line (`EdgeStretch`, a divider) by `delta` px, from the
 * sizes measured at the drag's start. The new position is clamped so every
 * cell on either side keeps its minimum, and snaps onto any line of the axis
 * within `snapPx` (`edgeTarget`; a stretch that is part of its line snaps
 * back onto its own line too: no change).
 *
 * - The whole line (or a stretch holding every cell edge on its line),
 *   staying between its two neighbouring lines: the two tracks beside it
 *   share their size anew (two weights; a fixed track's px; a fit row's
 *   height, its `fitPx` — `pairTrack`) — view state. Only that line moves
 *   (J14): two weighted tracks keep their summed weight, and a fixed or fit
 *   track beside a weighted one leaves the weighted one to give or take the
 *   px, re-weighted so every other weighted track keeps its size
 *   (`weightedTo`).
 * - Part of a line, or a move past a neighbouring line: the stretch leaves
 *   its line. Onto another line it just moves there (a piece snapped back
 *   onto a line it left re-joins it); anywhere else the track there splits
 *   in two at that point (a new line and track; the cells crossing it gain
 *   a span). The cells beside the stretch then end / start on the new line,
 *   and a line left as no cell's edge goes (`normalizeGrid`) — layout
 *   structure.
 *
 * The same layout when the stretch isn't one, the sizes don't match the
 * axis, or nothing moves.
 */
export function moveEdge<L extends LayoutBody>(layout: L, stretch: EdgeStretch, delta: number, opts: MoveEdgeOptions, genId: IdGen): L {
  const { axis, line } = stretch
  const tracks = layout.grid[axis]
  const { sizes } = opts
  const found = edgeTarget(layout, stretch, delta, opts)
  if (!found) return layout
  const { pos, target, snapped, whole, beforeIds, afterIds } = found
  const at = (i: number) => pos[i] ?? 0
  if (snapped === line || (snapped == null && target === at(line))) return layout

  if (whole && snapped == null && target > at(line - 1) && target < at(line + 1)) {
    const a = pairTrack(layout, axis, line - 1, sizes[line - 1])
    const b = pairTrack(layout, axis, line, sizes[line])
    if (!a || !b) return layout
    const sizeA = target - at(line - 1)
    const sizeB = at(line + 1) - target
    const [na, nb] = resizedPair(a.track, b.track, sizeA, sizeB)
    let out = replaceAt(replaceAt(tracks, line - 1, a.back(na)), line, b.back(nb))
    // A fixed (or fit) track beside a weighted one: the weighted one alone
    // gives or takes the px, the other weighted tracks keeping their sizes.
    if (a.track.px != null && b.track.px == null) out = weightedTo(layout, axis, out, line, sizeB, sizes)
    else if (b.track.px != null && a.track.px == null) out = weightedTo(layout, axis, out, line - 1, sizeA, sizes)
    return withTracks(layout, axis, out)
  }

  let next = layout
  let newLine = snapped
  if (newLine == null) {
    let t = 0
    while (t < tracks.length - 1 && target >= at(t + 1)) t++
    const size = sizes[t] ?? 0
    if (size <= 0) return layout
    next = splitTrack(next, axis, t, (target - at(t)) / size, genId())
    newLine = t + 1
  }
  // The stretch's line and the cells beside it, in `next`'s coordinates.
  const shift = (i: number) => (snapped == null && newLine != null && i >= newLine ? i + 1 : i)
  const oldLine = shift(line)
  const cells = next.cells.map((c) => {
    const [s, e] = spanOf(c.area, axis)
    if (beforeIds.has(c.id) && e === oldLine) return { ...c, area: withSpan(c.area, axis, s, newLine) }
    if (afterIds.has(c.id) && s === oldLine) return { ...c, area: withSpan(c.area, axis, newLine, e) }
    return c
  })
  if (cells.some((c) => c.area.colSpan < 1 || c.area.rowSpan < 1)) return layout
  return normalizeGrid(withCells(next, cells))
}

/**
 * A double-click on part of a line (not `isWholeLine`): the px delta
 * (`moveEdge`'s) that puts it midway between the latest start of the cells
 * before it and the earliest end of those after — its own cells even, as a
 * drag would move it, the rest of its line staying. `null` for a whole line
 * (its two tracks share evenly instead) or sizes that don't match the axis.
 */
export function evenStretchDelta(layout: LayoutBody, stretch: EdgeStretch, sizes: readonly number[]): number | null {
  const { axis, line } = stretch
  if (isWholeLine(layout, stretch) || sizes.length !== layout.grid[axis].length) return null
  const { before, after } = stretchCells(layout, stretch)
  if (before.length === 0 || after.length === 0) return null
  const pos = [0]
  for (const s of sizes) pos.push((pos.at(-1) ?? 0) + Math.max(0, s))
  const at = (i: number) => pos[i] ?? 0
  const start = Math.max(...before.map((c) => at(spanOf(c.area, axis)[0])))
  const end = Math.min(...after.map((c) => at(spanOf(c.area, axis)[1])))
  return (start + end) / 2 - at(line)
}

// ── View state and config ───────────────────────────────────────────────────

function updateTab<L extends LayoutBody>(layout: L, tabId: string, fn: (tab: LayoutTab) => LayoutTab): L {
  const loc = findTab(layout, tabId)
  const cell = loc ? layout.cells[loc.cellIdx] : undefined
  const tab = loc ? cell?.tabs[loc.tabIdx] : undefined
  if (!loc || !cell || !tab) return layout
  const next = fn(tab)
  if (next === tab) return layout
  const tabs = replaceAt(cell.tabs, loc.tabIdx, next)
  return setCell(layout, cell.id, withStrip(cell, { ...stripOf(cell), tabs, ...(cell.activeTabId === tab.id ? { activeTabId: next.id } : {}) }))
}

/**
 * View state: collapse / expand a row track (by id). Column tracks don't
 * collapse. Collapse row sets every track a cell covers, one call each, so
 * a collapse is taken as it is; an expand also expands any collapsed row it
 * leaves with nothing to expand it (`expandOrphanRows`): a cell that was
 * folded over this track and another now reaches into an expanded row.
 */
export function setTrackCollapsed<L extends LayoutBody>(layout: L, trackId: string, collapsed: boolean): L {
  const idx = layout.grid.rows.findIndex((t) => t.id === trackId)
  const track = layout.grid.rows[idx]
  if (!track || (track.collapsed === true) === collapsed) return layout
  const { collapsed: _drop, ...rest } = track
  void _drop
  const next = withTracks(layout, 'rows', replaceAt(layout.grid.rows, idx, collapsed ? { ...rest, collapsed: true } : rest))
  return collapsed ? next : expandOrphanRows(next)
}

/** The row tracks a cell covers (its ids, top to bottom). */
export function cellRowTracks(layout: LayoutBody, cellId: string): GridTrack[] {
  const cell = cellById(layout, cellId)
  if (!cell) return []
  const r = rectOf(cell.area)
  return layout.grid.rows.slice(r.r0, r.r1)
}

/** Whether a cell is collapsed: every row track it covers is. */
export function isCellCollapsed(layout: LayoutBody, cellId: string): boolean {
  const rows = cellRowTracks(layout, cellId)
  return rows.length > 0 && rows.every((t) => t.collapsed === true)
}

/** View state: make `tabId` its cell's active tab. */
export function setActiveTab<L extends LayoutBody>(layout: L, tabId: string): L {
  const loc = findTab(layout, tabId)
  const cell = loc ? layout.cells[loc.cellIdx] : undefined
  if (!cell || cell.activeTabId === tabId) return layout
  return setCell(layout, cell.id, withStrip(cell, { ...stripOf(cell), activeTabId: tabId }))
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
export function replaceTab<L extends LayoutBody>(layout: L, tabId: string, next: LayoutTab): L {
  if (next.id !== tabId && layoutIds(layout).has(next.id)) return layout
  return updateTab(layout, tabId, () => next)
}

/**
 * Layout config (items 11, 14): sets a tab's own name and / or its picked
 * icon. `null` removes one (a blank name is none; no icon key = never
 * picked, the kind's icon). The same layout when nothing changes.
 */
export function setTabLabel<L extends LayoutBody>(
  layout: L,
  tabId: string,
  patch: { name?: string | null; icon?: IconValue | null },
): L {
  return updateTab(layout, tabId, (tab) => {
    let next: LayoutTab = tab
    if (patch.name !== undefined) {
      const name = patch.name?.trim() || undefined
      if (name !== tab.name) {
        const { name: _n, ...rest } = next
        void _n
        next = (name ? { ...rest, name } : rest) as LayoutTab
      }
    }
    if (patch.icon !== undefined && !sameIcon(patch.icon ?? undefined, tab.icon)) {
      const { icon: _i, ...rest } = next
      void _i
      next = (patch.icon ? { ...rest, icon: patch.icon } : rest) as LayoutTab
    }
    return next
  })
}

/**
 * `next` (a tab of another kind, Change widget) keeping what the user gave
 * `from`: its picked icon, and its tab name when `next`'s kind takes one
 * (`tabOwnsName` false).
 */
export function withLabelOf(next: LayoutTab, from: LayoutTab | undefined): LayoutTab {
  if (!from) return next
  let out = next
  if (from.icon) out = { ...out, icon: from.icon }
  if (from.name && !tabOwnsName(next.kind)) out = { ...out, name: from.name }
  return out
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
 * `kind`. A key patched to `undefined` is removed (e.g. a tab
 * back on all tasks).
 */
export function patchTabConfig<L extends LayoutBody, K extends WidgetKind>(
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
export function patchTabViewState<L extends LayoutBody, K extends WidgetKind>(
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

/**
 * `body` with `model`'s track ids, when the two are the same arrangement
 * (`sameArrangement`) but some track ids differ: an edit that came back to
 * `model` by another way — a row inserted and closed again, whose merged
 * track kept the inserted one's id (`workspace-grid.mergeTracks`) — is
 * `model` again. The same object otherwise.
 */
export function withTrackIdsOf<L extends LayoutBody>(body: L, model: LayoutBody): L {
  const sameIds = (axis: GridAxis) => body.grid[axis].every((t, i) => t.id === model.grid[axis][i]?.id)
  if (sameIds('columns') && sameIds('rows')) return body
  if (!sameArrangement(body, model)) return body
  let next = body
  for (const axis of ['columns', 'rows'] as const) {
    next = withTracks(next, axis, body.grid[axis].map((t, i) => ({ ...t, id: model.grid[axis][i]?.id ?? t.id })))
  }
  return next
}
