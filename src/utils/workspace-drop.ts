import type { BandEdge, WorkspaceLayout } from '../models/workspace-layout'
import { cellAt, findCell, findTab, movePanel, moveTab, type LayoutDropTarget } from './workspace-layout-ops'

/**
 * Hit testing for dragging a workspace tab or a whole cell (in a column's row
 * or a band, by its header). The view measures the rendered bands / columns →
 * rows → cells / tabs into a {@link WorkspaceGeometry} and asks where the
 * pointer is; the answer maps to a `LayoutDropTarget` for `moveTab` /
 * `movePanel`.
 *
 * Priority (first match wins):
 * 1. Band edge → new band: within {@link BAND_EDGE_ZONE_PX} inside the
 *    workspace's top (bottom) edge — the top zone also reaches
 *    {@link BAND_EDGE_OUTSIDE_PX} above it, over the top bar's lower edge —
 *    full width, while there is no band there; but never over a tab strip:
 *    a cell's header always wins (in practice the zone is the workspace's
 *    padding above / below the cells, the gaps between columns, and that
 *    reach above the top edge).
 * 2. Column edge → new column: within {@link EDGE_ZONE_GUTTER_PX} either side
 *    of the gap between two columns, or within {@link EDGE_ZONE_OUTER_PX}
 *    inside the column area's outer left / right edge — only between the
 *    bands (the column area's height).
 * 3. A cell's header (its tab strip; a band's cell's too) → insert at that
 *    position. A headless cell's hidden strip is measured as no header.
 * 4. A cell body (a column's row) → its outer {@link SIDE_ZONE_SHARE} left /
 *    right (at most {@link SIDE_ZONE_MAX_PX}): a new cell beside it, in its
 *    row; of the middle that is left, the top quarter / bottom quarter: a
 *    new row above / below — the cell's row, which in a multi-cell row is
 *    named as the row (`row-edge`); the middle half: join as tab(s). An
 *    empty cell is one target.
 * 5. A band cell's body → left / right as a column cell's (a new cell beside
 *    it, in the band); the rest joins that cell (a band is one row: no top or
 *    bottom zone).
 * 6. The empty column area of a layout with bands but no columns → a first
 *    column.
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
  /** The header (tab strip); absent for an empty cell and while a headless cell's strip is hidden. */
  header: Rect | null
  /** The body below the header (a headless cell's: the whole card); absent for collapsed and empty cells. */
  body: Rect | null
  empty: boolean
  /** Tabs in strip order (visible ones; overflowed tabs are skipped). */
  tabs: ReadonlyArray<{ id: string; rect: Rect }>
}

/** A column's row: its cells side by side. */
export interface RowGeometry {
  id: string
  rect: Rect
  cells: readonly CellGeometry[]
}

/** A band: one row of cells spanning the workspace (`id` the band's). */
export interface BandGeometry extends RowGeometry {
  edge: BandEdge
}

export interface ColumnGeometry {
  id: string
  rect: Rect
  rows: readonly RowGeometry[]
}

export interface WorkspaceGeometry {
  /** The workspace area (bands, columns and its padding). */
  area: Rect
  /** The column area between the bands: the visible box (horizontal padding included). */
  columnArea: Rect
  columns: readonly ColumnGeometry[]
  bands: readonly BandGeometry[]
}

/** Half-width of the new-column zone centred on the gap between two columns. */
export const EDGE_ZONE_GUTTER_PX = 16
/** Width of the new-column zone just inside the column area's outer edges. */
export const EDGE_ZONE_OUTER_PX = 24
/** Height of the new-band zone just inside the workspace's top / bottom edge. */
export const BAND_EDGE_ZONE_PX = 24
/** How far the top new-band zone reaches above the workspace's top edge (over the top bar). */
export const BAND_EDGE_OUTSIDE_PX = 16
/** A cell body's left / right new-cell zones: this share of its width each … */
export const SIDE_ZONE_SHARE = 0.2
/** … but no wider than this (px), so a wide cell's middle stays the bigger part. */
export const SIDE_ZONE_MAX_PX = 120

/** A cell body's zones: beside it (`left` / `right`), a row above / below (`top` / `bottom`), or joining it. */
export type CellZone = 'left' | 'right' | 'top' | 'middle' | 'bottom'
/** A band cell's body zones: beside it, or joining it. */
export type BandZone = 'left' | 'middle' | 'right'

export type WorkspaceDropHit =
  | { kind: 'new-band'; edge: BandEdge }
  /** `gutter` 0 = left of the first column … `columns.length` = right of the last. */
  | { kind: 'column-edge'; gutter: number; x: number }
  /** A cell's or band's strip (`cellId` = the panel's id). `index` counts every tab in the strip (a dragged one included). */
  | { kind: 'tab-strip'; cellId: string; index: number; lineX: number }
  /** `rowId` = the cell's row; `multi` = the row holds other cells too (its top / bottom name the row). */
  | { kind: 'cell-body'; cellId: string; rowId: string; multi: boolean; zone: CellZone }
  | { kind: 'band-body'; edge: BandEdge; cellId: string; zone: BandZone }
  | { kind: 'empty-cell'; cellId: string }
  | { kind: 'empty-columns' }

/** What is dragged: one tab, or a whole panel (a cell or a band) by its header. */
export type WorkspaceDragSource =
  | { type: 'tab'; tabId: string }
  | { type: 'panel'; panelId: string }

/** Whether two hits are the same drop spot (every field equal). */
export function sameDropHit(a: WorkspaceDropHit | null, b: WorkspaceDropHit | null): boolean {
  if (a === null || b === null) return a === b
  switch (a.kind) {
    case 'new-band': return b.kind === 'new-band' && a.edge === b.edge
    case 'column-edge': return b.kind === 'column-edge' && a.gutter === b.gutter && a.x === b.x
    case 'tab-strip': return b.kind === 'tab-strip' && a.cellId === b.cellId && a.index === b.index && a.lineX === b.lineX
    case 'cell-body': return b.kind === 'cell-body' && a.cellId === b.cellId && a.rowId === b.rowId && a.multi === b.multi && a.zone === b.zone
    case 'band-body': return b.kind === 'band-body' && a.edge === b.edge && a.cellId === b.cellId && a.zone === b.zone
    case 'empty-cell': return b.kind === 'empty-cell' && a.cellId === b.cellId
    case 'empty-columns': return b.kind === 'empty-columns'
  }
}

export interface Point {
  x: number
  y: number
}

function inside(r: Rect, p: Point): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
}

/**
 * X position of every column edge: index 0 is the outer left edge, index `n`
 * the outer right edge, and the ones between are the centres of the gaps
 * between neighbouring columns. Empty for a layout without columns.
 */
export function columnEdgeXs(geo: WorkspaceGeometry): number[] {
  const cols = geo.columns
  const first = cols[0]
  const last = cols.at(-1)
  if (!first || !last) return []
  const xs = [(geo.columnArea.left + first.rect.left) / 2]
  for (let i = 1; i < cols.length; i++) {
    const prev = cols[i - 1]
    const next = cols[i]
    if (prev && next) xs.push((prev.rect.right + next.rect.left) / 2)
  }
  xs.push((last.rect.right + geo.columnArea.right) / 2)
  return xs
}

/** Every measured cell: the bands' and the columns' rows', in no particular order. */
export function geometryCells(geo: WorkspaceGeometry): CellGeometry[] {
  return [...geo.bands.flatMap((b) => b.cells), ...geo.columns.flatMap((c) => c.rows.flatMap((r) => r.cells))]
}

/** Which band edges have no band (where a new band can go). */
export function freeBandEdges(geo: WorkspaceGeometry): BandEdge[] {
  return (['top', 'bottom'] as const).filter((edge) => !geo.bands.some((b) => b.edge === edge))
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
  const loc = findCell(layout, hit.cellId)
  const ids = (loc ? cellAt(layout, loc)?.tabs ?? [] : []).map((t) => t.id)
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

/** Whether `p` is over any panel's header (a tab strip). */
function overStrip(geo: WorkspaceGeometry, p: Point): boolean {
  return geometryCells(geo).some((cell) => cell.header != null && inside(cell.header, p))
}

/** The new-band edge `p` is in, if any: a free edge's zone, outside every tab strip. */
function bandEdgeAt(geo: WorkspaceGeometry, p: Point): BandEdge | null {
  if (p.x < geo.area.left || p.x > geo.area.right) return null
  for (const edge of freeBandEdges(geo)) {
    const near = edge === 'top'
      ? p.y >= geo.area.top - BAND_EDGE_OUTSIDE_PX && p.y <= geo.area.top + BAND_EDGE_ZONE_PX
      : p.y <= geo.area.bottom && p.y >= geo.area.bottom - BAND_EDGE_ZONE_PX
    if (near && !overStrip(geo, p)) return edge
  }
  return null
}

export function hitTestWorkspace(geo: WorkspaceGeometry, p: Point): WorkspaceDropHit | null {
  if (geo.columns.length === 0 && geo.bands.length === 0) return null
  const bandEdge = bandEdgeAt(geo, p)
  if (bandEdge) return { kind: 'new-band', edge: bandEdge }
  if (!inside(geo.area, p)) return null

  const inColumnRows = p.y >= geo.columnArea.top && p.y <= geo.columnArea.bottom
  const edges = inColumnRows ? columnEdgeXs(geo) : []
  const lastGutter = edges.length - 1
  for (let g = 0; g < edges.length; g++) {
    const x = edges[g]
    if (x == null) continue
    const near = g === 0
      ? p.x <= geo.columnArea.left + EDGE_ZONE_OUTER_PX
      : g === lastGutter
        ? p.x >= geo.columnArea.right - EDGE_ZONE_OUTER_PX
        : Math.abs(p.x - x) <= EDGE_ZONE_GUTTER_PX
    if (near) return { kind: 'column-edge', gutter: g, x }
  }

  for (const band of geo.bands) {
    if (!inside(band.rect, p)) continue
    const cell = band.cells.find((c) => inside(c.rect, p))
    if (!cell) return null
    if (cell.empty) return { kind: 'empty-cell', cellId: cell.id }
    if (cell.header && inside(cell.header, p)) return stripHit(cell, cell.header, p)
    if (cell.body && inside(cell.body, p)) {
      const side = sideZone(cell.body, p)
      return { kind: 'band-body', edge: band.edge, cellId: cell.id, zone: side ?? 'middle' }
    }
    return null
  }

  if (inColumnRows && geo.columns.length === 0) return { kind: 'empty-columns' }

  for (const col of geo.columns) {
    if (p.x < col.rect.left || p.x > col.rect.right) continue
    for (const row of col.rows) {
      const cell = row.cells.find((c) => inside(c.rect, p))
      if (!cell) continue
      if (cell.empty) return { kind: 'empty-cell', cellId: cell.id }
      if (cell.header && inside(cell.header, p)) return stripHit(cell, cell.header, p)
      if (cell.body && inside(cell.body, p)) {
        return { kind: 'cell-body', cellId: cell.id, rowId: row.id, multi: row.cells.length > 1, zone: bodyZone(cell.body, p) }
      }
      return null
    }
  }
  return null
}

/** The left / right new-cell zone of `body` that `p` is in: its outer `SIDE_ZONE_SHARE` (at most `SIDE_ZONE_MAX_PX`) each side. */
function sideZone(body: Rect, p: Point): 'left' | 'right' | null {
  const side = Math.min((body.right - body.left) * SIDE_ZONE_SHARE, SIDE_ZONE_MAX_PX)
  if (p.x < body.left + side) return 'left'
  if (p.x > body.right - side) return 'right'
  return null
}

/** A column cell's body zone at `p`: a side, else the top / bottom quarter or the middle half of its height. */
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
    case 'new-band':
      return { kind: 'new-band', edge: hit.edge }
    case 'column-edge': {
      const cols = geo.columns
      const right = cols[hit.gutter]
      if (right) return { kind: 'column-edge', columnId: right.id, edge: 'left' }
      const last = cols.at(-1)
      return last ? { kind: 'column-edge', columnId: last.id, edge: 'right' } : null
    }
    case 'tab-strip': {
      const dragged = source.type === 'tab' ? source.tabId : null
      const at = layoutTabIndex(layout, geo, hit, dragged)
      const loc = dragged != null ? findTab(layout, dragged) : null
      const index = loc?.cellId === hit.cellId && loc.tabIdx < at ? at - 1 : at
      return { kind: 'cell', cellId: hit.cellId, index }
    }
    case 'cell-body':
      if (hit.zone === 'middle') return { kind: 'cell', cellId: hit.cellId }
      if ((hit.zone === 'top' || hit.zone === 'bottom') && hit.multi) return { kind: 'row-edge', rowId: hit.rowId, edge: hit.zone }
      return { kind: 'cell-edge', cellId: hit.cellId, edge: hit.zone }
    case 'band-body':
      if (hit.zone === 'middle') return { kind: 'cell', cellId: hit.cellId }
      return { kind: 'cell-edge', cellId: hit.cellId, edge: hit.zone }
    case 'empty-cell':
      return { kind: 'cell', cellId: hit.cellId }
    case 'empty-columns':
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
