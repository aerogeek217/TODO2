import type { BandEdge, WorkspaceLayout } from '../models/workspace-layout'
import { findTab, movePanel, moveTab, type LayoutDropTarget } from './workspace-layout-ops'

/**
 * Hit testing for dragging a workspace tab or a whole panel (a cell or a
 * band, by its header). The view measures the rendered bands / columns /
 * cells / tabs into a {@link WorkspaceGeometry} and asks where the pointer
 * is; the answer maps to a `LayoutDropTarget` for `moveTab` / `movePanel`.
 *
 * Priority (first match wins):
 * 1. Band edge → new band: within {@link BAND_EDGE_ZONE_PX} inside the
 *    workspace's top (bottom) edge, full width, while there is no band there.
 * 2. Column edge → new column: within {@link EDGE_ZONE_GUTTER_PX} either side
 *    of the gap between two columns, or within {@link EDGE_ZONE_OUTER_PX}
 *    inside the column area's outer left / right edge — only between the
 *    bands (the column area's height).
 * 3. A cell's or band's header (its tab strip) → insert at that position.
 * 4. A cell body → top quarter: new cell above; bottom quarter: new cell
 *    below; middle half: join as tab(s). An empty cell is one target.
 * 5. A band body → one zone: join the band (a band never splits).
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
  /** The header (tab strip); absent for an empty cell. */
  header: Rect | null
  /** The body below the header; absent for collapsed and empty cells. */
  body: Rect | null
  empty: boolean
  /** Tabs in strip order (visible ones; overflowed tabs are skipped). */
  tabs: ReadonlyArray<{ id: string; rect: Rect }>
}

/** A band: a full-width panel, measured as a cell is. */
export interface BandGeometry extends CellGeometry {
  edge: BandEdge
}

export interface ColumnGeometry {
  id: string
  rect: Rect
  cells: readonly CellGeometry[]
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

export type CellZone = 'top' | 'middle' | 'bottom'

export type WorkspaceDropHit =
  | { kind: 'new-band'; edge: BandEdge }
  /** `gutter` 0 = left of the first column … `columns.length` = right of the last. */
  | { kind: 'column-edge'; gutter: number; x: number }
  /** A cell's or band's strip (`cellId` = the panel's id). `index` counts every tab in the strip (a dragged one included). */
  | { kind: 'tab-strip'; cellId: string; index: number; lineX: number }
  | { kind: 'cell-body'; cellId: string; zone: CellZone }
  | { kind: 'band-body'; edge: BandEdge }
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
    case 'cell-body': return b.kind === 'cell-body' && a.cellId === b.cellId && a.zone === b.zone
    case 'band-body': return b.kind === 'band-body' && a.edge === b.edge
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

export function hitTestWorkspace(geo: WorkspaceGeometry, p: Point): WorkspaceDropHit | null {
  if (!inside(geo.area, p)) return null
  if (geo.columns.length === 0 && geo.bands.length === 0) return null

  for (const edge of freeBandEdges(geo)) {
    const near = edge === 'top' ? p.y <= geo.area.top + BAND_EDGE_ZONE_PX : p.y >= geo.area.bottom - BAND_EDGE_ZONE_PX
    if (near) return { kind: 'new-band', edge }
  }

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
    if (band.header && inside(band.header, p)) return stripHit(band, band.header, p)
    if (band.body && inside(band.body, p)) return { kind: 'band-body', edge: band.edge }
    return null
  }

  if (inColumnRows && geo.columns.length === 0) return { kind: 'empty-columns' }

  for (const col of geo.columns) {
    if (p.x < col.rect.left || p.x > col.rect.right) continue
    for (const cell of col.cells) {
      if (!inside(cell.rect, p)) continue
      if (cell.empty) return { kind: 'empty-cell', cellId: cell.id }
      if (cell.header && inside(cell.header, p)) return stripHit(cell, cell.header, p)
      if (cell.body && inside(cell.body, p)) {
        const h = cell.body.bottom - cell.body.top
        const rel = h > 0 ? (p.y - cell.body.top) / h : 0.5
        const zone: CellZone = rel < 0.25 ? 'top' : rel > 0.75 ? 'bottom' : 'middle'
        return { kind: 'cell-body', cellId: cell.id, zone }
      }
      return null
    }
  }
  return null
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
      const loc = source.type === 'tab' ? findTab(layout, source.tabId) : null
      const index = loc?.panelId === hit.cellId && loc.tabIdx < hit.index ? hit.index - 1 : hit.index
      return { kind: 'cell', cellId: hit.cellId, index }
    }
    case 'cell-body':
      if (hit.zone === 'middle') return { kind: 'cell', cellId: hit.cellId }
      return { kind: 'cell-edge', cellId: hit.cellId, edge: hit.zone }
    case 'band-body':
      return { kind: 'band', edge: hit.edge }
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
