import type { WorkspaceLayout } from '../models/workspace-layout'
import { findTab } from './workspace-layout-queries'
import { movePanel, moveTab, type LayoutDropTarget } from './workspace-layout-ops'
import type { Side } from './workspace-grid'

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
 * 3. A cell's header (its tab strip) → insert at that position. A headless
 *    cell's hidden strip is none (`dropStrip`).
 * 4. A cell body → its outer {@link SIDE_ZONE_SHARE} left / right (at most
 *    {@link SIDE_ZONE_MAX_PX}): split it that side; of the middle that is
 *    left, the top quarter / bottom quarter: split it above / below; the
 *    middle half: join as tab(s). An empty cell is one target.
 * 5. The empty area of a layout with no cells → its first cell.
 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface CellGeometry {
  id: string
  /** The whole cell card. */
  rect: Rect
  /** The header (tab strip) as drawn; absent for an empty cell. A headless cell's is out of view (see `headless`). */
  header: Rect | null
  /**
   * The cell hides its strip (`utils/workspace-rows.isHeadlessCell`; it stays
   * out during a drag): its header is no drop target (`dropStrip`), and its
   * body is the whole card.
   */
  headless?: boolean
  /** The body below the header (a headless cell's: the whole card); absent for collapsed and empty cells. */
  body: Rect | null
  empty: boolean
  /** Tabs in strip order (visible ones; overflowed tabs are skipped). */
  tabs: ReadonlyArray<{ id: string; rect: Rect }>
}

export interface WorkspaceGeometry {
  /** The workspace area (the table and its padding). */
  area: Rect
  /** Every cell of the table, as drawn. */
  cells: readonly CellGeometry[]
}

/** Width of the insert-column zone just inside the workspace's left / right edge. */
export const EDGE_ZONE_OUTER_PX = 24
/** Height of the insert-row zone just inside the workspace's top / bottom edge. */
export const INSERT_EDGE_ZONE_PX = 24
/** How far the insert-row zones reach past the workspace's top edge (over the top bar) and its bottom edge. */
export const INSERT_EDGE_OUTSIDE_PX = 16
/** A cell body's left / right split zones: this share of its width each … */
export const SIDE_ZONE_SHARE = 0.2
/** … but no wider than this (px), so a wide cell's middle stays the bigger part. */
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

/**
 * The tab strip a drop can land on in `cell`: its header, unless the cell is
 * headless (its strip is out of view during a drag, so its body — the whole
 * card — takes every drop). The one place the headless rule meets the hit test.
 */
export function dropStrip(cell: CellGeometry): Rect | null {
  return cell.headless === true ? null : cell.header
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
  const strip = dropStrip(cell)
  if (strip && inside(strip, p)) return stripHit(cell, strip, p)
  if (cell.body && inside(cell.body, p)) return { kind: 'cell-body', cellId: cell.id, zone: bodyZone(cell.body, p) }
  return null
}

/** The left / right split zone of `body` that `p` is in: its outer `SIDE_ZONE_SHARE` (at most `SIDE_ZONE_MAX_PX`) each side. */
function sideZone(body: Rect, p: Point): 'left' | 'right' | null {
  const side = Math.min((body.right - body.left) * SIDE_ZONE_SHARE, SIDE_ZONE_MAX_PX)
  if (p.x < body.left + side) return 'left'
  if (p.x > body.right - side) return 'right'
  return null
}

/** A cell body's zone at `p`: a side, else the top / bottom quarter or the middle half of its height. */
function bodyZone(body: Rect, p: Point): CellZone {
  const side = sideZone(body, p)
  if (side) return side
  const h = body.bottom - body.top
  const rel = h > 0 ? (p.y - body.top) / h : 0.5
  return rel < 0.25 ? 'top' : rel > 0.75 ? 'bottom' : 'middle'
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
  let n = 0
  const genId = () => `probe-${++n}`
  const next = source.type === 'tab'
    ? moveTab(layout, source.tabId, target, genId)
    : movePanel(layout, source.panelId, target, genId)
  return next !== layout
}
