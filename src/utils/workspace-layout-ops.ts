import {
  DEFAULT_WEIGHT,
  tabOwnsName,
  type CellArea,
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
  expandOrphanTracks,
  neighbours,
  normalizeGrid,
  rectOf,
  sameArea,
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
import type { NumberConfig, NumberItem } from '../models/glance-widgets'
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
 * - `swap` — a whole cell trades places with the cell (`movePanel`, a card
 *   dropped on another card's middle in the layout edit mode); tabs can't
 *   swap, so for them it is `cell` (they join it).
 */
export type LayoutDropTarget =
  | { kind: 'cell'; cellId: string; index?: number }
  | { kind: 'swap'; cellId: string }
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
 * keeps its id, the second takes `id` and `rest` of its size (default the
 * remainder; less when the new line's gutter comes out of the track);
 * every cell crossing it spans both, every cell after it shifts by one.
 */
function splitTrack<L extends LayoutBody>(layout: L, axis: GridAxis, t: number, share: number, id: string, rest = 1 - share): L {
  const track = layout.grid[axis][t]
  if (!track) return layout
  const first = halfTrack(track, track.id, share)
  const second = halfTrack(track, id, rest)
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
 * cell, or an empty one with no taker. A collapsed track the close leaves
 * with no filled cell lying only in it expands (`expandOrphanTracks`, as
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
  return expandOrphanTracks(setCell(layout, cellId, withStrip(cell, { tabs: [] })))
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
 * `layout` with the tracks under `cell` expanded, each axis on its own,
 * when every one of them is collapsed: a new (empty) cell never comes out
 * collapsed — it would show only a header (or lie in a column's strip), and
 * an empty cell has no Expand. A split's other half keeps its collapse when
 * it lies in other tracks (a split below / above a folded row, left / right
 * of a folded column); beside it in the same row (column), the row (column)
 * expands: collapse is the track's.
 */
function expandedFor<L extends LayoutBody>(layout: L, cell: LayoutCell): L {
  let next = layout
  for (const axis of ['columns', 'rows'] as const) {
    const [start, end] = spanOf(cell.area, axis)
    const tracks = next.grid[axis].slice(start, end)
    if (tracks.length === 0 || !tracks.every((t) => t.collapsed === true)) continue
    next = tracks.reduce<L>((acc, t) => setTrackCollapsed(acc, t.id, false), next)
  }
  return next
}

/**
 * A new track at the layout's `edge` (a row at the top / bottom, a column
 * at the left / right) holding one new empty cell across the whole layout.
 * It takes half the size of the nearest weighted track on that axis (which
 * keeps the other half) — one drawn by its weight (`trackSizing`): not a
 * fixed track, a Numbers-only (fit) row or a collapsed row, whose weight
 * shares nothing —; with none, the default weight. In an empty layout,
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
  // A weighted track as drawn: a fit row's or a collapsed row's weight isn't in use (cr34 W6).
  const heirIdx = order.find((i) => trackSizing(layout, axis, i).kind === 'weighted')
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
 * A new row or column beside cell `cellId`'s own (Layout ▸ Insert row ▸
 * Above / Below this row, Insert column ▸ Left / Right of this column):
 * a track at the cell's edge line on `side`, across the whole layout. It
 * takes half the size of the cell's own track next to that line (or, when
 * that one isn't drawn by its weight, of the nearest weighted track; with
 * none, the default weight). The cells crossing the line grow into the new
 * track; every gap they leave along it gets a new empty cell. At the
 * layout's outer edge it is `insertTrack`. Returns the first new cell's id
 * (`null` with none, or for an unknown cell: then the same layout).
 */
export function insertTrackBeside<L extends LayoutBody>(layout: L, cellId: string, side: Side, genId: IdGen): { layout: L; cellId: string | null } {
  const cell = cellById(layout, cellId)
  if (!cell) return { layout, cellId: null }
  const axis = sideAxis(side)
  const tracks = layout.grid[axis]
  const [start, end] = spanOf(cell.area, axis)
  const before = side === 'left' || side === 'top'
  const line = before ? start : end
  if (line === 0 || line === tracks.length) return insertTrack(layout, side, genId)
  return insertTrackOnLine(layout, axis, line, before ? line : line - 1, genId)
}

/**
 * A new full row / column on inner line `line` of `axis` (layout edit
 * mode E2): it takes half the size of track `own` (or, when that one isn't
 * drawn by its weight, of the nearest weighted track; with none, the
 * default weight). The cells crossing the line grow into the new track;
 * every gap they leave along it gets a new empty cell. Returns the first
 * new cell's id (`null` with none).
 */
function insertTrackOnLine<L extends LayoutBody>(layout: L, axis: GridAxis, line: number, own: number, genId: IdGen): { layout: L; cellId: string | null } {
  const tracks = layout.grid[axis]
  // The heir: the track `own`, else the nearest weighted one.
  const weighted = (i: number) => trackSizing(layout, axis, i).kind === 'weighted'
  const heirIdx = weighted(own)
    ? own
    : tracks.map((_, i) => i).filter(weighted).sort((a, b) => Math.abs(a - own) - Math.abs(b - own))[0]
  const heir = heirIdx != null ? tracks[heirIdx] : undefined
  let resized = tracks
  let weight = DEFAULT_WEIGHT
  if (heir && heirIdx != null) {
    weight = (heir.weight ?? DEFAULT_WEIGHT) / 2
    resized = replaceAt(tracks, heirIdx, { ...heir, weight })
  }
  const newTrack: GridTrack = { id: genId(), weight }

  // Cells after the line move down / right; cells crossing it grow into the new track.
  const cross = crossAxis(axis)
  const crossing: Array<[number, number]> = []
  const moved = layout.cells.map((c) => {
    const [s, e] = spanOf(c.area, axis)
    if (s >= line) return { ...c, area: withSpan(c.area, axis, s + 1, e + 1) }
    if (e > line) {
      crossing.push(spanOf(c.area, cross))
      return { ...c, area: withSpan(c.area, axis, s, e + 1) }
    }
    return c
  })
  // The new track's gaps between crossing cells: a new empty cell each.
  crossing.sort((a, b) => a[0] - b[0])
  const crossCount = layout.grid[cross].length
  const added: LayoutCell[] = []
  let at = 0
  const fill = (to: number) => {
    if (to <= at) return
    const area = axis === 'rows'
      ? { col: at, row: line, colSpan: to - at, rowSpan: 1 }
      : { col: line, row: at, colSpan: 1, rowSpan: to - at }
    added.push({ id: genId(), area, tabs: [] })
  }
  for (const [s, e] of crossing) {
    fill(s)
    at = Math.max(at, e)
  }
  fill(crossCount)
  const next = withCells(withTracks(layout, axis, insertAt(resized, line, newTrack)), [...moved, ...added])
  const first = added[0]
  return { layout: normalizeGrid(first ? expandedFor(next, first) : next), cellId: first?.id ?? null }
}

/**
 * A new full row / column on line `index` of `axis` (layout edit mode E2:
 * a ruler's "+", its menu's Insert … left / right / above / below): line 0
 * and the last line are the layout's edges (`insertTrack`); on an inner line
 * the cells crossing it grow across the new track and its other places
 * become new empty cells (as `insertTrackBeside` does on a cell's line). It
 * takes half the size of track `from` (default: the track after the line,
 * else the one before) when that one is drawn by its weight, else of the
 * nearest weighted track. Returns the first new cell's id; the same layout
 * (and `null`) for a line that isn't one.
 *
 * `through` (> `index`): lines `index` … `through` act as one line — the
 * tracks between them are slivers (`utils/layout-rulers`), a few px a part
 * line moved left. They are merged into the track after the run (else the
 * one before; `mergeTrackInto`, so no cell lying across them moves more
 * than their few px) and the new track goes on the one line left, so only
 * the cells spanning the whole run cross it. `from` then names a track of
 * the layout as given (a sliver among them counts as none).
 */
export function insertTrackAt<L extends LayoutBody>(layout: L, axis: GridAxis, index: number, genId: IdGen, from?: number, through = index): { layout: L; cellId: string | null } {
  const count = layout.grid[axis].length
  if (!Number.isInteger(index) || index < 0 || index > count) return { layout, cellId: null }
  if (Number.isInteger(through) && through > index && through <= count) return insertTrackOverRun(layout, axis, index, through, genId, from)
  if (layout.cells.length === 0 || index === 0) return insertTrack(layout, axis === 'columns' ? 'left' : 'top', genId)
  if (index === count) return insertTrack(layout, axis === 'columns' ? 'right' : 'bottom', genId)
  const own = from != null && (from === index - 1 || from === index) ? from : index
  return insertTrackOnLine(layout, axis, index, own, genId)
}

/** `insertTrackAt` over the run of lines `first` … `last` (the tracks between them slivers): merged into one line, then inserted on it. */
function insertTrackOverRun<L extends LayoutBody>(layout: L, axis: GridAxis, first: number, last: number, genId: IdGen, from?: number): { layout: L; cellId: string | null } {
  const tracks = layout.grid[axis]
  const runIds = tracks.slice(first, last).map((t) => t.id)
  const afterId = tracks[last]?.id
  const beforeId = first > 0 ? tracks[first - 1]?.id : undefined
  const intoId = afterId ?? beforeId
  if (intoId == null) return { layout, cellId: null }
  const fromId = from != null && !runIds.includes(tracks[from]?.id ?? '') ? tracks[from]?.id : undefined
  const indexOf = (body: LayoutBody, id: string) => body.grid[axis].findIndex((t) => t.id === id)
  let next: L = layout
  // Each merged into its neighbour on the way to `intoId`: the nearest first, so they stay beside it.
  for (const id of afterId != null ? [...runIds].reverse() : runIds) {
    const i = indexOf(next, id)
    const into = indexOf(next, intoId)
    if (i < 0 || into < 0) continue
    next = mergeTrackInto(next, axis, i, into, genId)
  }
  const line = afterId != null ? indexOf(next, afterId) : next.grid[axis].length
  if (line < 0) return { layout, cellId: null }
  const own = fromId != null ? indexOf(next, fromId) : -1
  return insertTrackAt(next, axis, line, genId, own >= 0 ? own : undefined)
}

// ── Removing a track ────────────────────────────────────────────────────────

/**
 * Where a cell lying only in a track that goes ends up (`trackRemoval`): its
 * tabs join cell `into` (after that cell's own tabs, which keeps its active
 * tab), or — `into: null` — the cell itself moves into the place beside it,
 * which held only empty cells.
 */
interface TrackRemovalMove {
  cellId: string
  tabIds: string[]
  into: string | null
}

/** What removing a track does: the track its space and places go to, and each widget-holding cell that moves. */
export interface TrackRemoval {
  /** The neighbouring track (its index before the removal) that takes the track's space and its cells' places. */
  neighbour: number
  moves: TrackRemovalMove[]
}

/** The cells covering track `neighbour` of `axis` somewhere over `[from, to)` of the other axis, in order along it. */
function cellsInTrackOver(layout: LayoutBody, axis: GridAxis, neighbour: number, from: number, to: number): LayoutCell[] {
  const cross = crossAxis(axis)
  return layout.cells
    .filter((c) => {
      const [s, e] = spanOf(c.area, axis)
      const [cs, ce] = spanOf(c.area, cross)
      return s <= neighbour && neighbour < e && cs < to && from < ce
    })
    .sort((a, b) => spanOf(a.area, cross)[0] - spanOf(b.area, cross)[0])
}

/**
 * What removing track `index` of `axis` does (`removeTrack`), toward
 * track `into` (default the track before, else the one after); `null` when
 * it can't go — the axis's last track, an index that isn't one, or `into`
 * not beside it.
 *
 * Along the axis every cell either lies only in the track, spans it and
 * other tracks, or doesn't touch it. A cell spanning it — passing through,
 * or starting or ending in it — loses that track and stays (it shrinks).
 * A cell lying only in it moves into the neighbouring track over its own
 * extent across the other axis (its *place*), in reading order:
 *
 * - its place holds only empty cells: the cell moves there (`into: null`) —
 *   the empty cells give that place up, what is left of them staying empty;
 * - else its tabs join a filled cell of that place: the one sharing the most
 *   of its edge, the first along it on a tie (a cell sticking out past the
 *   place's ends counts only the part beside it);
 * - an empty cell lying only in the track just goes.
 *
 * No widget is ever deleted.
 */
export function trackRemoval(layout: LayoutBody, axis: GridAxis, index: number, into?: number): TrackRemoval | null {
  const count = layout.grid[axis].length
  if (count < 2 || !Number.isInteger(index) || index < 0 || index >= count) return null
  const neighbour = into ?? (index > 0 ? index - 1 : index + 1)
  if (Math.abs(neighbour - index) !== 1 || neighbour < 0 || neighbour >= count) return null
  const cross = crossAxis(axis)
  const moves: TrackRemovalMove[] = []
  for (const c of readingOrderOf(layout.cells)) {
    const [s, e] = spanOf(c.area, axis)
    if (s !== index || e !== index + 1 || c.tabs.length === 0) continue
    const [from, to] = spanOf(c.area, cross)
    const place = cellsInTrackOver(layout, axis, neighbour, from, to)
    const filled = place.filter((p) => p.tabs.length > 0)
    if (filled.length === 0) {
      moves.push({ cellId: c.id, tabIds: c.tabs.map((t) => t.id), into: null })
      continue
    }
    const shared = (p: LayoutCell) => {
      const [ps, pe] = spanOf(p.area, cross)
      return Math.min(pe, to) - Math.max(ps, from)
    }
    const target = filled.reduce((best, p) => (shared(p) > shared(best) ? p : best))
    moves.push({ cellId: c.id, tabIds: c.tabs.map((t) => t.id), into: target.id })
  }
  return { neighbour, moves }
}

function readingOrderOf(cells: readonly LayoutCell[]): LayoutCell[] {
  return [...cells].sort((a, b) => a.area.row - b.area.row || a.area.col - b.area.col)
}

/**
 * The cells of an occupancy matrix (`grid[row][col]`: the id of the cell
 * there) as rectangles: a cell whose places are a rectangle keeps them;
 * one whose places aren't (an empty cell a move carved) is cut into
 * rectangles — in reading order, each as wide as it runs and then as deep
 * as that whole run goes —, the first keeping its id, the others new ids.
 */
function cellsFromMatrix(matrix: string[][], byId: ReadonlyMap<string, LayoutCell>, genId: IdGen): LayoutCell[] {
  const rows = matrix.length
  const cols = matrix[0]?.length ?? 0
  const taken = matrix.map((line) => line.map(() => false))
  const seen = new Set<string>()
  const out: LayoutCell[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (taken[r]?.[c]) continue
      const id = matrix[r]?.[c]
      if (id == null) continue
      let c1 = c + 1
      while (c1 < cols && matrix[r]?.[c1] === id && !taken[r]?.[c1]) c1++
      let r1 = r + 1
      const runs = (rr: number) => {
        for (let x = c; x < c1; x++) if (matrix[rr]?.[x] !== id || taken[rr]?.[x]) return false
        return true
      }
      while (r1 < rows && runs(r1)) r1++
      for (let y = r; y < r1; y++) for (let x = c; x < c1; x++) {
        const line = taken[y]
        if (line) line[x] = true
      }
      const src = byId.get(id)
      if (!src) continue
      const area = { col: c, row: r, colSpan: c1 - c, rowSpan: r1 - r }
      if (seen.has(id)) out.push({ id: genId(), area, tabs: [] })
      else out.push(sameArea(src.area, area) ? src : { ...src, area })
      seen.add(id)
    }
  }
  return out
}

/**
 * Removes track `index` of `axis` toward track `into` (beside it): the
 * cells change as `trackRemoval` says, and the track's size goes to `into`
 * when both are drawn by their weights (the weights added) or both are
 * fixed (the px added), so the other lines stay where they are. The same
 * layout when it can't go (`trackRemoval` is `null`).
 */
function removeTrackToward<L extends LayoutBody>(layout: L, axis: GridAxis, index: number, into: number | undefined, genId: IdGen): L {
  const plan = trackRemoval(layout, axis, index, into)
  if (!plan) return layout
  const { neighbour } = plan
  const cross = crossAxis(axis)
  const cols = layout.grid.columns.length
  const rows = layout.grid.rows.length
  // The occupancy matrix: the cell id at each [row][col].
  const matrix: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(''))
  for (const c of layout.cells) {
    for (let r = c.area.row; r < c.area.row + c.area.rowSpan; r++) {
      for (let k = c.area.col; k < c.area.col + c.area.colSpan; k++) {
        const line = matrix[r]
        if (line) line[k] = c.id
      }
    }
  }
  const at = (a: number, x: number): [number, number] => (axis === 'columns' ? [x, a] : [a, x])
  const byId = new Map(layout.cells.map((c) => [c.id, c]))
  const joined = new Map<string, LayoutTab[]>()
  for (const move of plan.moves) {
    const cell = byId.get(move.cellId)
    if (!cell) continue
    if (move.into == null) {
      // Into the place beside it: those places become the cell's.
      const [from, to] = spanOf(cell.area, cross)
      for (let x = from; x < to; x++) {
        const [r, k] = at(neighbour, x)
        const line = matrix[r]
        if (line) line[k] = cell.id
      }
    } else {
      joined.set(move.into, [...(joined.get(move.into) ?? []), ...cell.tabs])
    }
  }
  // The track goes: its line of the matrix.
  const kept = axis === 'rows'
    ? matrix.filter((_, r) => r !== index)
    : matrix.map((line) => line.filter((_, k) => k !== index))
  let cells = cellsFromMatrix(kept, byId, genId)
  if (joined.size > 0) {
    cells = cells.map((c) => {
      const extra = joined.get(c.id)
      return extra ? withStrip(c, stripWith([...c.tabs, ...extra], c.activeTabId)) : c
    })
  }
  // The track's size to its neighbour, where both share space the same way.
  const tracks = layout.grid[axis]
  const gone = tracks[index]
  const heir = tracks[neighbour]
  let resized = tracks
  if (gone && heir) {
    const a = trackSizing(layout, axis, index)
    const b = trackSizing(layout, axis, neighbour)
    if (a.kind === 'weighted' && b.kind === 'weighted') resized = replaceAt(tracks, neighbour, { ...heir, weight: (heir.weight ?? DEFAULT_WEIGHT) + (gone.weight ?? 0) })
    else if (a.kind === 'fixed' && b.kind === 'fixed' && gone.px != null && heir.px != null) resized = replaceAt(tracks, neighbour, { ...heir, px: heir.px + gone.px })
  }
  const next = withCells(withTracks(layout, axis, removeAt(resized, index)), cells)
  return normalizeGrid(next)
}

/**
 * Removes track `index` of `axis` (a ruler's Remove row / column, layout
 * edit mode E2) toward the track before it, else the one after: cells
 * spanning it shrink, a cell lying only in it moves into the place beside
 * it or its tabs join a cell there (`trackRemoval` says which), and its
 * size goes to that track. Refused — the same layout — for the axis's last
 * track or an index that isn't one. Never deletes a widget.
 */
export function removeTrack<L extends LayoutBody>(layout: L, axis: GridAxis, index: number, genId: IdGen): L {
  return removeTrackToward(layout, axis, index, undefined, genId)
}

/**
 * Merges track `index` of `axis` into its neighbour `into` (a sliver's
 * Merge into B, layout edit mode E2): the line between them goes. The
 * track's space joins `into`; every cell edge on that line moves to the
 * track's far line — the cells spanning the track lose it, the cells in
 * `into` grow over it —, and a cell lying only in the track moves as
 * `removeTrack` moves one (toward `into`). The same layout when `into`
 * isn't beside it, or it is its axis's last track.
 */
export function mergeTrackInto<L extends LayoutBody>(layout: L, axis: GridAxis, index: number, into: number, genId: IdGen): L {
  if (Math.abs(into - index) !== 1) return layout
  return removeTrackToward(layout, axis, index, into, genId)
}

/**
 * Even all widths / heights (a ruler's menu): every track of `axis` drawn
 * by its weight takes the same weight (their mean, so their sum stays);
 * fixed, fit and collapsed tracks keep theirs. A size change (view state).
 * The same layout when they already are even.
 */
export function evenTracks<L extends LayoutBody>(layout: L, axis: GridAxis): L {
  const tracks = layout.grid[axis]
  const weighted = tracks.flatMap((_, i) => (trackSizing(layout, axis, i).kind === 'weighted' ? [i] : []))
  if (weighted.length < 2) return layout
  const mean = weighted.reduce((sum, i) => sum + (tracks[i]?.weight ?? DEFAULT_WEIGHT), 0) / weighted.length
  if (!(mean > 0) || weighted.every((i) => tracks[i]?.weight === mean)) return layout
  const set = new Set(weighted)
  return withTracks(layout, axis, tracks.map((t, i) => (set.has(i) ? { ...t, weight: mean } : t)))
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
    case 'cell':
    case 'swap': {
      const cell = cellById(layout, target.cellId)
      if (!cell) return null
      const at = (target.kind === 'cell' ? target.index : undefined) ?? cell.tabs.length
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
 * neighbour or the new cell takes it, or it stays as an empty cell). Onto
 * an empty cell (a slot — a whole cell moves only in the layout edit mode,
 * E3) the two swap places (`swapCells`): the cell takes the slot's area and
 * its old place is the empty cell, so a move never grows a card over its
 * old place. A `swap` target trades the two cells' places whole
 * (`swapCells`). A drop onto the cell itself (its strip or a
 * side), or back where it is, returns the layout unchanged; so does an
 * empty cell.
 */
export function movePanel<L extends LayoutBody>(layout: L, cellId: string, target: LayoutDropTarget, genId: IdGen): L {
  const cell = cellById(layout, cellId)
  const first = cell?.tabs[0]
  if (!cell || !first) return layout
  if ((target.kind === 'cell' || target.kind === 'split' || target.kind === 'swap') && target.cellId === cellId) return layout
  if (target.kind === 'swap') return swapCells(layout, cellId, target.cellId)
  const into = target.kind === 'cell' ? cellById(layout, target.cellId) : undefined
  if (into && into.tabs.length === 0) return swapCells(layout, cellId, into.id)
  const next = relocate(layout, cellId, (l) => placeTabs(l, cell.tabs, target, genId, cell.activeTabId))
  return next ? unlessBackInPlace(layout, next, first.id, cellId) : layout
}

// ── Dividers ────────────────────────────────────────────────────────────────

/** How far (px) a divider drag reaches to snap onto another line. */
export const EDGE_SNAP_PX = 8

export interface MoveEdgeOptions {
  /** Each track's size (px) along the stretch's axis, as measured when the drag started. */
  sizes: readonly number[]
  /**
   * The gap (px) the table draws between tracks (`--workspace-gutter`),
   * default 0. A line's place is its tracks' sizes and the gaps before it,
   * so a stretch moved into or past other tracks stays under the pointer,
   * and a new line's gutter comes out of the track it splits (cr34 W8).
   */
  gap?: number
  /** Snap onto another line within this many px (default `EDGE_SNAP_PX`). */
  snapPx?: number
  /**
   * A whole line snaps back onto its own place too (within `snapPx`: no
   * change). Nothing in the app passes it since the crossing handles went
   * (E4); the layout-op fuzz tests' two-line moves do.
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
 * tracks are assumed drawn by their weights — `drawnByWeight` makes them so
 * first when one is held at its minimum.
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

/** How far (px) a weighted track may be drawn from its weight's share before it counts as held at its minimum (`drawnByWeight`). */
const WEIGHT_SHARE_TOLERANCE_PX = 0.5

/**
 * `layout` with the weights of `axis` saying what is drawn (`sizes`, the
 * tracks as measured): when some weighted track isn't drawn by its weight —
 * the grid holds it up at its cells' minimum (`minmax(min, n fr)`), so the
 * others share less than their weights say — every weighted track's weight
 * becomes its measured size's share of their summed weight. That draws the
 * same table, and a resize computed from it moves only its own line by
 * what was asked: computed from the stored weights, the line would lag the
 * pointer and the other lines drift (cr34 W7). The same layout when every
 * weighted track is drawn by its weight (within half a px), so a move among
 * such tracks changes only its own two.
 */
function drawnByWeight<L extends LayoutBody>(layout: L, axis: GridAxis, sizes: readonly number[]): L {
  const tracks = layout.grid[axis]
  const weighted: Array<{ i: number; weight: number; size: number }> = []
  let weights = 0
  let px = 0
  for (let i = 0; i < tracks.length; i++) {
    const s = trackSizing(layout, axis, i)
    if (s.kind !== 'weighted') continue
    const size = sizes[i] ?? 0
    if (!(s.weight > 0) || !(size > 0)) return layout
    weighted.push({ i, weight: s.weight, size })
    weights += s.weight
    px += size
  }
  if (weighted.length < 2) return layout
  if (weighted.every((t) => Math.abs(t.size - (px * t.weight) / weights) <= WEIGHT_SHARE_TOLERANCE_PX)) return layout
  const out = [...tracks]
  for (const t of weighted) {
    const track = tracks[t.i]
    if (track) out[t.i] = { ...track, weight: (weights * t.size) / px }
  }
  return withTracks(layout, axis, out)
}

/**
 * Weighted row track `i` re-weighted to draw `size` px, every other
 * weighted row keeping its size in `sizes` (`weightedTo`, over the weights
 * as drawn — `drawnByWeight`) — after a fit row beside it changed height (a
 * double-click clearing its `fitPx`), so only the line between them moves.
 * The same layout when there is nothing to re-weight.
 */
export function withRowDrawnAt<L extends LayoutBody>(layout: L, i: number, size: number, sizes: readonly number[]): L {
  if (sizes.length !== layout.grid.rows.length) return layout
  const based = drawnByWeight(layout, 'rows', sizes)
  const tracks = based.grid.rows
  const next = weightedTo(based, 'rows', tracks, i, size, sizes)
  return next === tracks ? layout : withTracks(based, 'rows', next)
}

/**
 * Each line's place (px) along an axis, from its tracks' measured `sizes`
 * and the `gap` drawn between them: entry `k` is where track `k` starts —
 * the far side of the gutter line `k` lies in —, the last one a gap past
 * the last track's end. So every inner line is measured at the same point
 * of its gutter, a cell from line `s` to line `e` is `[e] − [s] − gap`
 * wide, and track `k` ends at `[k + 1] − gap`.
 */
function lineStarts(sizes: readonly number[], gap: number): number[] {
  const pos = [0]
  for (const s of sizes) pos.push((pos.at(-1) ?? 0) + Math.max(0, s) + gap)
  return pos
}

/**
 * `result` — a structural move's table — with the tracks of `axis` sized
 * as the move means them drawn: every line where it was, the moved stretch
 * where it was put. `starts` is where each track starts, by id (a merged
 * track has its first part's id, `mergeTracks`), `end` where the last one
 * ends. A weighted track's weight becomes its px at the weight-per-px the
 * weighted tracks of `original` were drawn at (`sizes`), a fixed track's
 * px its size; a fit or collapsed row is left alone. The ops' own sizes —
 * a split's shares, a merge's sums — don't count the gutter a new line
 * takes or a merged line gives back, nor a track held at its minimum.
 */
function drawnAt<L extends LayoutBody>(result: L, axis: GridAxis, starts: ReadonlyMap<string, number>, end: number, gap: number, original: LayoutBody, sizes: readonly number[]): L {
  let weights = 0
  let px = 0
  original.grid[axis].forEach((_, i) => {
    const s = trackSizing(original, axis, i)
    if (s.kind !== 'weighted') return
    weights += s.weight
    px += Math.max(0, sizes[i] ?? 0)
  })
  const perPx = weights > 0 && px > 0 ? weights / px : null
  const tracks = result.grid[axis]
  const out = tracks.map((t, k) => {
    const start = starts.get(t.id)
    const after = tracks[k + 1]
    const stop = after ? (starts.get(after.id) ?? NaN) - gap : end
    if (start == null || !(stop - start > 0)) return t
    const size = stop - start
    const sizing = trackSizing(result, axis, k)
    if (sizing.kind === 'weighted') return perPx != null && t.weight !== size * perPx ? { ...t, weight: size * perPx } : t
    if (sizing.kind === 'fixed' && t.px != null) {
      const whole = Math.max(1, Math.round(size))
      return whole === t.px ? t : { ...t, px: whole }
    }
    return t
  })
  return out.every((t, k) => t === tracks[k]) ? result : withTracks(result, axis, out)
}

/** Where a stretch's drag lands: its clamped, snapped position and what it means (`edgeTarget`). */
interface EdgeTarget {
  /** Each line's place (px) at the drag's start (`lineStarts`). */
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
  const { sizes, snapPx = EDGE_SNAP_PX, minPx = defaultMinPx, snapHome = false, gap = 0 } = opts
  if (line < 1 || line >= tracks.length || sizes.length !== tracks.length || !Number.isFinite(delta)) return null
  const { before, after } = stretchCells(layout, stretch)
  if (before.length === 0 || after.length === 0) return null
  const pos = lineStarts(sizes, gap)
  const at = (i: number) => pos[i] ?? 0
  // A cell from line s to line e is at(e) − at(s) − gap wide (`lineStarts`).
  const least = Math.max(...before.map((c) => at(spanOf(c.area, axis)[0]) + minPx(c, axis) + gap))
  const most = Math.min(...after.map((c) => at(spanOf(c.area, axis)[1]) - minPx(c, axis) - gap))
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
 *   structure. Drawn with a gap between tracks (`opts.gap`), the tracks are
 *   then sized so every other line stays where it was and the stretch is
 *   where it was put (`drawnAt`).
 *
 * The same layout when the stretch isn't one, the sizes don't match the
 * axis, or nothing moves.
 */
export function moveEdge<L extends LayoutBody>(layout: L, stretch: EdgeStretch, delta: number, opts: MoveEdgeOptions, genId: IdGen): L {
  const { axis, line } = stretch
  const tracks = layout.grid[axis]
  const { sizes, gap = 0 } = opts
  const found = edgeTarget(layout, stretch, delta, opts)
  if (!found) return layout
  const { pos, target, snapped, whole, beforeIds, afterIds } = found
  const at = (i: number) => pos[i] ?? 0
  if (snapped === line || (snapped == null && target === at(line))) return layout

  // The two tracks beside the line, were it at `target` (`lineStarts`: a track ends a gap before the next starts).
  const sizeA = target - at(line - 1) - gap
  const sizeB = at(line + 1) - gap - target
  if (whole && snapped == null && sizeA > 0 && sizeB > 0) {
    // From the weights as drawn: a track held at its minimum would make the line lag and the others drift.
    const based = drawnByWeight(layout, axis, sizes)
    const a = pairTrack(based, axis, line - 1, sizes[line - 1])
    const b = pairTrack(based, axis, line, sizes[line])
    if (!a || !b) return layout
    const [na, nb] = resizedPair(a.track, b.track, sizeA, sizeB)
    let out = replaceAt(replaceAt(based.grid[axis], line - 1, a.back(na)), line, b.back(nb))
    // A fixed (or fit) track beside a weighted one: the weighted one alone
    // gives or takes the px, the other weighted tracks keeping their sizes.
    if (a.track.px != null && b.track.px == null) out = weightedTo(based, axis, out, line, sizeB, sizes)
    else if (b.track.px != null && a.track.px == null) out = weightedTo(based, axis, out, line - 1, sizeA, sizes)
    return withTracks(based, axis, out)
  }

  let next = layout
  let newLine = snapped
  // Where each track starts, by id: what the result's tracks are sized from (`drawnAt`).
  const starts = new Map(tracks.map((t, i) => [t.id, at(i)]))
  if (newLine == null) {
    let t = 0
    while (t < tracks.length - 1 && target >= at(t + 1)) t++
    const size = sizes[t] ?? 0
    // The track's two parts: up to the new line's gutter, and from the line on.
    const first = target - gap - at(t)
    const second = at(t) + size - target
    if (!(size > 0) || !(first > 0) || !(second > 0)) return layout
    const id = genId()
    next = splitTrack(next, axis, t, first / size, id, second / size)
    starts.set(id, target)
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
  const moved = normalizeGrid(withCells(next, cells))
  // Drawn with gaps, a new line's gutter and a merged line's are px the shares and sums above leave out.
  return gap > 0 ? drawnAt(moved, axis, starts, at(tracks.length) - gap, gap, layout, sizes) : moved
}

/**
 * A double-click on part of a line (not `isWholeLine`): the px delta
 * (`moveEdge`'s) that puts it midway between the latest start of the cells
 * before it and the earliest end of those after — its own cells even, as a
 * drag would move it, the rest of its line staying. `null` for a whole line
 * (its two tracks share evenly instead) or sizes that don't match the axis.
 * `gap` as `MoveEdgeOptions.gap`: the gap drawn between tracks.
 */
export function evenStretchDelta(layout: LayoutBody, stretch: EdgeStretch, sizes: readonly number[], gap = 0): number | null {
  const { axis, line } = stretch
  if (isWholeLine(layout, stretch) || sizes.length !== layout.grid[axis].length) return null
  const { before, after } = stretchCells(layout, stretch)
  if (before.length === 0 || after.length === 0) return null
  const pos = lineStarts(sizes, gap)
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
 * View state: collapse / expand a track (by id), a row or a column. Collapse
 * row (column) sets every track a cell covers, one call each, so a collapse
 * is taken as it is; an expand also expands any collapsed track it leaves
 * with nothing to expand it (`expandOrphanTracks`): a cell that was folded
 * over this track and another now reaches into an expanded one.
 */
export function setTrackCollapsed<L extends LayoutBody>(layout: L, trackId: string, collapsed: boolean): L {
  for (const axis of ['rows', 'columns'] as const) {
    const tracks = layout.grid[axis]
    const idx = tracks.findIndex((t) => t.id === trackId)
    const track = tracks[idx]
    if (!track) continue
    if ((track.collapsed === true) === collapsed) return layout
    const { collapsed: _drop, ...rest } = track
    void _drop
    const next = withTracks(layout, axis, replaceAt(tracks, idx, collapsed ? { ...rest, collapsed: true } : rest))
    return collapsed ? next : expandOrphanTracks(next)
  }
  return layout
}

/** The row tracks a cell covers (its ids, top to bottom). */
export function cellRowTracks(layout: LayoutBody, cellId: string): GridTrack[] {
  const cell = cellById(layout, cellId)
  if (!cell) return []
  const r = rectOf(cell.area)
  return layout.grid.rows.slice(r.r0, r.r1)
}

/** The column tracks a cell covers (left to right). */
export function cellColumnTracks(layout: LayoutBody, cellId: string): GridTrack[] {
  const cell = cellById(layout, cellId)
  if (!cell) return []
  const r = rectOf(cell.area)
  return layout.grid.columns.slice(r.c0, r.c1)
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
 * Layout config: shallow-patches the Number `itemId` of whichever Numbers
 * widget holds it (its config; its id stays). A key patched to `undefined`
 * is removed. The same layout when nothing changes or no widget holds it.
 */
export function patchNumberItem<L extends LayoutBody>(layout: L, itemId: string, patch: Partial<NumberConfig>): L {
  const tab = layout.cells.flatMap((c) => c.tabs).find((t) => t.kind === 'numbers' && t.config.items.some((item) => item.id === itemId))
  if (tab?.kind !== 'numbers') return layout
  return updateTab(layout, tab.id, () => {
    const items = tab.config.items.map((item) => {
      if (item.id !== itemId) return item
      const patched = shallowPatch(item, patch)
      return patched === item ? item : Object.fromEntries(Object.entries(patched).filter(([, v]) => v !== undefined)) as NumberItem
    })
    return items.every((item, i) => item === tab.config.items[i]) ? tab : { ...tab, config: { ...tab.config, items } }
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

/**
 * Remove widget outside the layout edit mode (layout edit mode E4, the rule
 * "edit mode changes the grid; what's inside a cell changes in place"):
 * removes a tab as `closeTab` does, but a cell it leaves with no tabs stays
 * where it is as an empty cell — its space goes to no neighbour (only the
 * mode's Close cell gives a cell away, `closeCell`). A collapsed track the
 * removal leaves with no filled cell lying only in it expands
 * (`expandOrphanTracks`). The same layout for an unknown tab.
 */
export function removeTabKeepCell<L extends LayoutBody>(layout: L, tabId: string): L {
  const loc = findTab(layout, tabId)
  const cell = loc ? layout.cells[loc.cellIdx] : undefined
  if (!loc || !cell) return layout
  if (cell.tabs.length > 1) return closeTab(layout, tabId)
  return expandOrphanTracks(setCell(layout, cell.id, withStrip(cell, { tabs: [] })))
}

/**
 * Where widgets brought from another layout land (Move / Copy to layout,
 * placed in the layout edit mode): a cell — an empty one they fill, or a
 * card they join as its last tabs —, a new full-width row at the bottom, or
 * a full track inserted on a line (a ruler's "+": `insertTrackAt`'s `index`
 * and `through`).
 */
export type IncomingTarget =
  | { kind: 'cell'; cellId: string }
  | { kind: 'bottom' }
  | { kind: 'line'; axis: GridAxis; index: number; through?: number }

/**
 * `tabs` (none of them in `layout`) placed at `target` (`IncomingTarget`);
 * a cell they make or fill shows `activeTabId` (default the first), a card
 * they join shows the first of them. Returns the layout and the cell that
 * holds them — `null` (the same layout) when the target doesn't exist or a
 * tab's id is taken.
 */
export function placeIncomingTabs<L extends LayoutBody>(
  layout: L,
  tabs: readonly LayoutTab[],
  target: IncomingTarget,
  genId: IdGen,
  activeTabId?: string,
): { layout: L; cellId: string | null } {
  const ids = layoutIds(layout)
  if (tabs.length === 0 || tabs.some((t) => ids.has(t.id))) return { layout, cellId: null }
  switch (target.kind) {
    case 'cell': {
      const cell = cellById(layout, target.cellId)
      if (!cell) return { layout, cellId: null }
      if (cell.tabs.length === 0) return { layout: fillCell(layout, cell.id, tabs, activeTabId), cellId: cell.id }
      const joined = placeTabs(layout, tabs, { kind: 'cell', cellId: cell.id }, genId)
      return joined ? { layout: joined, cellId: cell.id } : { layout, cellId: null }
    }
    case 'bottom': {
      const inserted = insertTrack(layout, 'bottom', genId)
      return { layout: fillCell(inserted.layout, inserted.cellId, tabs, activeTabId), cellId: inserted.cellId }
    }
    case 'line': {
      const inserted = insertTrackAt(layout, target.axis, target.index, genId, undefined, target.through)
      if (inserted.cellId == null) return { layout, cellId: null }
      return { layout: fillCell(inserted.layout, inserted.cellId, tabs, activeTabId), cellId: inserted.cellId }
    }
  }
}

/** `layout` without tabs `tabIds`, each removed as Remove widget removes it (`removeTabKeepCell`: a lone widget's cell stays, empty). */
export function removeTabsKeepCell<L extends LayoutBody>(layout: L, tabIds: readonly string[]): L {
  return tabIds.reduce((l, id) => removeTabKeepCell(l, id), layout)
}

// ── Cards (layout edit mode E3) ─────────────────────────────────────────────

/** Whether `area` lies in `layout`'s grid: whole tracks, at least one each way, inside it. */
function areaInGrid(layout: LayoutBody, area: CellArea): boolean {
  const { col, row, colSpan, rowSpan } = area
  if (![col, row, colSpan, rowSpan].every(Number.isInteger)) return false
  return col >= 0 && row >= 0 && colSpan >= 1 && rowSpan >= 1
    && col + colSpan <= layout.grid.columns.length && row + rowSpan <= layout.grid.rows.length
}

/** Whether two areas share a place. */
function areasOverlap(a: CellArea, b: CellArea): boolean {
  return a.col < b.col + b.colSpan && b.col < a.col + a.colSpan && a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan
}

/**
 * Whether cell `cellId` may take `area` (`setCellArea`): the area lies in
 * the grid and covers nothing but the cell's own places and empty cells
 * (whole or in part). `false` for an unknown cell.
 */
export function cellAreaFits(layout: LayoutBody, cellId: string, area: CellArea): boolean {
  if (!cellById(layout, cellId) || !areaInGrid(layout, area)) return false
  return layout.cells.every((c) => c.id === cellId || c.tabs.length === 0 || !areasOverlap(c.area, area))
}

/**
 * Stretches (or shrinks, or moves) cell `cellId` onto `area` (a card's
 * corner, Stretch right / down, Shift+arrow — layout edit mode E3). Valid
 * only over the cell's own places and empty cells (`cellAreaFits`): the
 * empty cells it covers give those places up — what is left of one is cut
 * into rectangles (in reading order, each as wide as it runs, then as deep
 * as that run goes; the first piece keeps its id) —, and the places it
 * leaves become empty cells, cut the same way. No widget moves or goes.
 * The same layout for an unknown cell, the area it has, or one that
 * doesn't fit.
 */
export function setCellArea<L extends LayoutBody>(layout: L, cellId: string, area: CellArea, genId: IdGen): L {
  const cell = cellById(layout, cellId)
  if (!cell || sameArea(cell.area, area) || !cellAreaFits(layout, cellId, area)) return layout
  const rows = layout.grid.rows.length
  const cols = layout.grid.columns.length
  const matrix: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(''))
  const fill = (a: CellArea, id: string) => {
    for (let r = a.row; r < a.row + a.rowSpan; r++) {
      const line = matrix[r]
      if (line) for (let k = a.col; k < a.col + a.colSpan; k++) line[k] = id
    }
  }
  for (const c of layout.cells) fill(c.area, c.id)
  // The places it leaves: one new empty cell (cut into rectangles when they aren't one).
  const vacated: LayoutCell = { id: genId(), area: cell.area, tabs: [] }
  fill(cell.area, vacated.id)
  fill(area, cellId)
  const byId = new Map<string, LayoutCell>([...layout.cells.map((c) => [c.id, c] as const), [vacated.id, vacated] as const])
  return normalizeGrid(withCells(layout, cellsFromMatrix(matrix, byId, genId)))
}

/**
 * Swaps two cells' places (a card's Swap with ▸, Alt+arrow onto a card —
 * layout edit mode E3): each takes the other's area, keeping its id, tabs
 * and active tab; the tiling holds whatever their sizes. The same layout
 * for an unknown cell or a cell with itself.
 */
export function swapCells<L extends LayoutBody>(layout: L, aId: string, bId: string): L {
  const a = cellById(layout, aId)
  const b = cellById(layout, bId)
  if (!a || !b || a === b) return layout
  return normalizeGrid(setCell(setCell(layout, aId, { ...a, area: b.area }), bId, { ...b, area: a.area }))
}
