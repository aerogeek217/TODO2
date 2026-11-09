import type { LayoutBody, WorkspaceLayout } from '../models/workspace-layout'
import { findTab } from './workspace-layout-queries'
import { movePanel, moveTab, type LayoutDropTarget } from './workspace-layout-ops'
import { cellById, spanOf, type Side } from './workspace-grid'
import { spanPx, tableTrackSizes, trackStart } from './workspace-table'

/**
 * Hit testing for dragging a workspace tab or a whole cell (by its header).
 * The view measures the rendered cells of the layout's table into a
 * {@link WorkspaceGeometry} and asks where the pointer is; the answer maps
 * to a `LayoutDropTarget` for `moveTab` / `movePanel`.
 *
 * Priority (first match wins):
 * 1. The layout's left / right edge → insert a column: within
 *    {@link EDGE_ZONE_OUTER_PX} inside the workspace's outer edge.
 * 2. The layout's top / bottom edge → insert a row: within
 *    {@link INSERT_EDGE_ZONE_PX} inside the workspace's top (bottom) edge —
 *    reaching {@link INSERT_EDGE_OUTSIDE_PX} past it too —, full width; but
 *    never over a cell (its strip and its body's zones win).
 * 3. A cell's header (its tab strip) → insert at that position. A cell
 *    with one widget has none (D26 AA1): its whole card is its body.
 * 4. A cell body → its outer {@link SIDE_ZONE_SHARE} on each side (at
 *    most {@link SIDE_ZONE_MAX_PX}): split it that side (in a corner, the
 *    side the pointer is deeper into); the middle: join as tab(s). An
 *    empty cell is one target.
 * 5. The empty area of a layout with no cells → its first cell.
 *
 * What a drop will make is drawn as one ghost (`dropGhost`): the op run on
 * a probe copy of the layout, and the cell that ends up holding what is
 * dragged placed from the table's tracks as measured when the drag started.
 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface CellGeometry {
  id: string
  /** Its active tab's title (a split's ghost names it). */
  title?: string
  /** The whole cell card. */
  rect: Rect
  /** The header (tab strip) as drawn; absent for an empty cell and a cell of one widget (it has no strip). */
  header: Rect | null
  /**
   * The body below the header — a cell of one widget's is the whole card,
   * collapsed or not —; absent for a collapsed cell with a strip and an
   * empty cell.
   */
  body: Rect | null
  empty: boolean
  /** Tabs in strip order (visible ones; overflowed tabs are skipped). */
  tabs: ReadonlyArray<{ id: string; rect: Rect }>
}

/** The table's grid as measured when the drag started: what the ghost's rectangle is placed from. */
export interface TableMetrics {
  /** The viewport point of its content's top-left corner (where track 0 starts; its scroll counted). */
  left: number
  top: number
  /** Its content box (px): the room the tracks share. */
  width: number
  height: number
  /** The gap between tracks (px). */
  gap: number
  /** Each row track's drawn height (px), by id: a fit row keeps it. */
  rowPx: Readonly<Record<string, number>>
}

export interface WorkspaceGeometry {
  /** The workspace area (the table and its padding). */
  area: Rect
  /** Every cell of the table, as drawn. */
  cells: readonly CellGeometry[]
  /** The table's grid; absent for an empty layout. */
  table?: TableMetrics
}

/** Width of the insert-column zone just inside the workspace's left / right edge. */
export const EDGE_ZONE_OUTER_PX = 24
/** Height of the insert-row zone just inside the workspace's top / bottom edge. */
export const INSERT_EDGE_ZONE_PX = 24
/** How far the insert-row zones reach past the workspace's top edge (over the top bar) and its bottom edge. */
export const INSERT_EDGE_OUTSIDE_PX = 16
/** A cell body's split zones: this share of its width (height) on each side … */
export const SIDE_ZONE_SHARE = 0.2
/** … but no deeper than this (px), so a big cell's middle stays the bigger part. */
export const SIDE_ZONE_MAX_PX = 120

/** A cell body's zones: a split on that side (`left` / `right` / `top` / `bottom`), or joining it. */
export type CellZone = Side | 'middle'

export type WorkspaceDropHit =
  /** The layout's edge: insert a row / column there. */
  | { kind: 'insert'; edge: Side }
  /** A cell's strip. `index` counts every tab in the strip (a dragged one included). */
  | { kind: 'tab-strip'; cellId: string; index: number; lineX: number }
  | { kind: 'cell-body'; cellId: string; zone: CellZone }
  | { kind: 'empty-cell'; cellId: string }
  | { kind: 'empty-layout' }

/** What is dragged: one tab, or a whole panel (a cell) by its header. */
export type WorkspaceDragSource =
  | { type: 'tab'; tabId: string }
  | { type: 'panel'; panelId: string }

/** Whether two hits are the same drop spot (every field equal). */
export function sameDropHit(a: WorkspaceDropHit | null, b: WorkspaceDropHit | null): boolean {
  if (a === null || b === null) return a === b
  switch (a.kind) {
    case 'insert': return b.kind === 'insert' && a.edge === b.edge
    case 'tab-strip': return b.kind === 'tab-strip' && a.cellId === b.cellId && a.index === b.index && a.lineX === b.lineX
    case 'cell-body': return b.kind === 'cell-body' && a.cellId === b.cellId && a.zone === b.zone
    case 'empty-cell': return b.kind === 'empty-cell' && a.cellId === b.cellId
    case 'empty-layout': return b.kind === 'empty-layout'
  }
}

export interface Point {
  x: number
  y: number
}

function inside(r: Rect, p: Point): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
}

/** Every measured cell. */
export function geometryCells(geo: WorkspaceGeometry): readonly CellGeometry[] {
  return geo.cells
}

/** The strip hit for a point over `cell`'s header: the insertion index and line. */
function stripHit(cell: CellGeometry, header: Rect, p: Point): WorkspaceDropHit {
  let index = 0
  for (const t of cell.tabs) {
    if (p.x > (t.rect.left + t.rect.right) / 2) index++
  }
  const before = cell.tabs[index]
  const lastTab = cell.tabs.at(-1)
  const lineX = before
    ? before.rect.left - 1
    : lastTab ? lastTab.rect.right + 1 : header.left + 4
  return { kind: 'tab-strip', cellId: cell.id, index, lineX }
}

/**
 * A strip hit's insertion point among the panel's tabs in the layout. The
 * hit counts the tabs the strip shows; with some folded into `+N` (and the
 * active one shown out of turn), a gap maps to just before the shown tab
 * right of it, where the strip draws the drop line (the last gap: just after
 * the last shown tab). A gap next to the dragged tab itself is no move, as on
 * an unfolded strip — the dragged tab's own place — even when folded tabs lie
 * between it and its shown neighbour.
 */
function layoutTabIndex(
  layout: WorkspaceLayout,
  geo: WorkspaceGeometry,
  hit: { cellId: string; index: number },
  draggedTabId: string | null,
): number {
  const ids = (layout.cells.find((c) => c.id === hit.cellId)?.tabs ?? []).map((t) => t.id)
  const shown = geometryCells(geo).find((c) => c.id === hit.cellId)?.tabs ?? []
  const prev = shown[hit.index - 1]
  const next = shown[hit.index]
  const ownIdx = draggedTabId != null ? ids.indexOf(draggedTabId) : -1
  if (ownIdx !== -1 && (prev?.id === draggedTabId || next?.id === draggedTabId)) return ownIdx
  const nextIdx = next ? ids.indexOf(next.id) : -1
  if (nextIdx !== -1) return nextIdx
  const lastIdx = prev ? ids.indexOf(prev.id) : -1
  return lastIdx !== -1 ? lastIdx + 1 : Math.min(hit.index, ids.length)
}

/** Whether `p` is over any cell's card (its strip, its body, a collapsed or an empty cell). */
function overCell(geo: WorkspaceGeometry, p: Point): boolean {
  return geometryCells(geo).some((cell) => inside(cell.rect, p))
}

/**
 * The insert edge `p` is in, if any: the left / right zone just inside the
 * workspace's side edges; the top / bottom zone (reaching past the edge
 * too), but never over a cell — its strip and its body's top / bottom zones
 * win.
 */
function insertEdgeAt(geo: WorkspaceGeometry, p: Point): Side | null {
  const { area } = geo
  if (p.y >= area.top && p.y <= area.bottom) {
    if (p.x >= area.left && p.x <= area.left + EDGE_ZONE_OUTER_PX) return 'left'
    if (p.x <= area.right && p.x >= area.right - EDGE_ZONE_OUTER_PX) return 'right'
  }
  if (p.x < area.left || p.x > area.right || overCell(geo, p)) return null
  if (p.y >= area.top - INSERT_EDGE_OUTSIDE_PX && p.y <= area.top + INSERT_EDGE_ZONE_PX) return 'top'
  if (p.y <= area.bottom + INSERT_EDGE_OUTSIDE_PX && p.y >= area.bottom - INSERT_EDGE_ZONE_PX) return 'bottom'
  return null
}

export function hitTestWorkspace(geo: WorkspaceGeometry, p: Point): WorkspaceDropHit | null {
  if (geo.cells.length === 0) return inside(geo.area, p) ? { kind: 'empty-layout' } : null
  const edge = insertEdgeAt(geo, p)
  if (edge) return { kind: 'insert', edge }
  if (!inside(geo.area, p)) return null
  const cell = geo.cells.find((c) => inside(c.rect, p))
  if (!cell) return null
  if (cell.empty) return { kind: 'empty-cell', cellId: cell.id }
  const strip = cell.header
  if (strip && inside(strip, p)) return stripHit(cell, strip, p)
  if (cell.body && inside(cell.body, p)) return { kind: 'cell-body', cellId: cell.id, zone: bodyZone(cell.body, p) }
  return null
}

/**
 * A cell body's zone at `p`: a split on the side whose zone it is in — its
 * outer `SIDE_ZONE_SHARE` that way, at most `SIDE_ZONE_MAX_PX` —, in a
 * corner the side it is deeper into (by the share of that zone); else the
 * middle.
 */
export function bodyZone(body: Rect, p: Point): CellZone {
  const zw = Math.min((body.right - body.left) * SIDE_ZONE_SHARE, SIDE_ZONE_MAX_PX)
  const zh = Math.min((body.bottom - body.top) * SIDE_ZONE_SHARE, SIDE_ZONE_MAX_PX)
  // How deep into each side's zone the point is: 1 at the edge, 0 at the zone's inner end, below 0 past it.
  const depth = (gap: number, zone: number) => (zone > 0 ? 1 - gap / zone : -1)
  const sides: Array<[Side, number]> = [
    ['left', depth(p.x - body.left, zw)],
    ['right', depth(body.right - p.x, zw)],
    ['top', depth(p.y - body.top, zh)],
    ['bottom', depth(body.bottom - p.y, zh)],
  ]
  let best: [Side, number] | null = null
  for (const s of sides) if (s[1] > 0 && (!best || s[1] > best[1])) best = s
  return best ? best[0] : 'middle'
}

/**
 * The layout target a hit stands for, for what is dragged. Inside its own
 * strip a tab's position counts the *other* tabs (as `moveTab` expects).
 */
export function dropTargetForHit(
  layout: WorkspaceLayout,
  geo: WorkspaceGeometry,
  hit: WorkspaceDropHit,
  source: WorkspaceDragSource,
): LayoutDropTarget | null {
  switch (hit.kind) {
    case 'insert':
      return { kind: 'insert', edge: hit.edge }
    case 'tab-strip': {
      const dragged = source.type === 'tab' ? source.tabId : null
      const at = layoutTabIndex(layout, geo, hit, dragged)
      const loc = dragged != null ? findTab(layout, dragged) : null
      const index = loc?.cellId === hit.cellId && loc.tabIdx < at ? at - 1 : at
      return { kind: 'cell', cellId: hit.cellId, index }
    }
    case 'cell-body':
      return hit.zone === 'middle' ? { kind: 'cell', cellId: hit.cellId } : { kind: 'split', cellId: hit.cellId, side: hit.zone }
    case 'empty-cell':
      return { kind: 'cell', cellId: hit.cellId }
    case 'empty-layout':
      return { kind: 'layout' }
  }
}

/** Whether dropping what is dragged on `target` would change the layout. */
export function dropChangesLayout(layout: WorkspaceLayout, source: WorkspaceDragSource, target: LayoutDropTarget): boolean {
  return probeDrop(layout, source, target) !== layout
}

/** The layout a drop would make (the same object when it changes nothing), with throwaway ids. */
function probeDrop(layout: WorkspaceLayout, source: WorkspaceDragSource, target: LayoutDropTarget): WorkspaceLayout {
  let n = 0
  const genId = () => `probe-${++n}`
  return source.type === 'tab'
    ? moveTab(layout, source.tabId, target, genId)
    : movePanel(layout, source.panelId, target, genId)
}

// ── The ghost ───────────────────────────────────────────────────────────────

/** What a drop will make, drawn where it lands: a rectangle (viewport px) and its words. */
export interface DropGhost {
  rect: Rect
  label: string
}

/** The side words of a split's label ("Split Late · above"). */
const SIDE_WORDS: Record<Side, string> = { left: 'left', right: 'right', top: 'above', bottom: 'below' }

/** A split's words: "Split Late · above", or with no title "Split · above" (Add widget's Where). */
export function splitLabel(side: Side, title?: string): string {
  return `Split ${title ? `${title} · ` : '· '}${SIDE_WORDS[side]}`
}

/** An insert's words: "Insert row · full width" / "Insert column · full height". */
export function insertLabel(edge: Side): string {
  return edge === 'top' || edge === 'bottom' ? 'Insert row · full width' : 'Insert column · full height'
}

/** A drop into a cell's strip: "Add as tab", or "Add 3 tabs". */
export function tabLabel(tabCount = 1): string {
  return tabCount > 1 ? `Add ${tabCount} tabs` : 'Add as tab'
}

/** What a drop on `target` says: "Split Late · above", "Insert row · full width", "Add as tab". */
export function dropLabel(geo: WorkspaceGeometry, target: LayoutDropTarget, tabCount: number): string {
  switch (target.kind) {
    case 'split': {
      const title = geo.cells.find((c) => c.id === target.cellId)?.title
      return title ? splitLabel(target.side, title) : `Split ${SIDE_WORDS[target.side]}`
    }
    case 'insert':
      return insertLabel(target.edge)
    case 'cell':
      return tabLabel(tabCount)
    case 'layout':
      return 'First cell'
  }
}

/**
 * The rectangle (viewport px) cell `cellId` of `body` takes in the table
 * measured as `table`: its tracks sized as the view sizes them
 * (`workspace-table.tableTrackSizes`; a fit row as it was drawn), from the
 * table's content corner. `null` for an unknown cell.
 */
export function cellRectIn(body: LayoutBody, cellId: string, table: TableMetrics): Rect | null {
  const cell = cellById(body, cellId)
  if (!cell) return null
  const cols = tableTrackSizes(body, 'columns', table.width, table.gap)
  const rows = tableTrackSizes(body, 'rows', table.height, table.gap, new Map(Object.entries(table.rowPx)))
  const [c0, c1] = spanOf(cell.area, 'columns')
  const [r0, r1] = spanOf(cell.area, 'rows')
  const left = table.left + trackStart(cols, c0, table.gap)
  const top = table.top + trackStart(rows, r0, table.gap)
  return { left, top, right: left + spanPx(cols, c0, c1, table.gap), bottom: top + spanPx(rows, r0, r1, table.gap) }
}

/**
 * The ghost of a drop of what is dragged (`source`; `tabIds` its tabs) on
 * `target`: the move run on a probe copy of the layout, and the cell that
 * then holds the first dragged tab placed from the geometry measured when
 * the drag started (`cellRectIn`) — the place and size the drop will
 * produce — with its words (`dropLabel`). An empty layout's first cell is
 * the whole area. `null` when the drop changes nothing.
 */
export function dropGhost(
  layout: WorkspaceLayout,
  geo: WorkspaceGeometry,
  source: WorkspaceDragSource,
  target: LayoutDropTarget,
  tabIds: readonly string[],
): DropGhost | null {
  const next = probeDrop(layout, source, target)
  if (next === layout) return null
  const label = dropLabel(geo, target, tabIds.length)
  if (layout.cells.length === 0 || !geo.table) return { rect: geo.area, label }
  const first = tabIds[0] ?? (source.type === 'tab' ? source.tabId : undefined)
  const holder = first != null ? findTab(next, first)?.cellId : undefined
  const rect = holder != null ? cellRectIn(next, holder, geo.table) : null
  return rect ? { rect, label } : null
}
