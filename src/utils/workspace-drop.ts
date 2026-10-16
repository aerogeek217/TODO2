import type { WorkspaceLayout } from '../models/workspace-layout'
import { findTab, moveTab, type LayoutDropTarget } from './workspace-layout-ops'

/**
 * Hit testing for dragging a workspace tab. The view measures the rendered
 * columns / cells / tabs into a {@link WorkspaceGeometry} and asks where the
 * pointer is; the answer maps to a `LayoutDropTarget` for `moveTab`.
 *
 * Priority (first match wins):
 * 1. Column edge → new column: within {@link EDGE_ZONE_GUTTER_PX} either side
 *    of the gap between two columns, or within {@link EDGE_ZONE_OUTER_PX}
 *    inside the workspace's outer left / right edge.
 * 2. A cell header (its tab strip) → insert the tab at that position.
 * 3. A cell body → top quarter: new cell above; bottom quarter: new cell
 *    below; middle half: join as a tab. An empty cell is one target.
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

export interface ColumnGeometry {
  id: string
  rect: Rect
  cells: readonly CellGeometry[]
}

export interface WorkspaceGeometry {
  /** The workspace area (columns plus its padding). */
  area: Rect
  columns: readonly ColumnGeometry[]
}

/** Half-width of the new-column zone centred on the gap between two columns. */
export const EDGE_ZONE_GUTTER_PX = 16
/** Width of the new-column zone just inside the workspace's outer edges. */
export const EDGE_ZONE_OUTER_PX = 24

export type CellZone = 'top' | 'middle' | 'bottom'

export type WorkspaceDropHit =
  /** `gutter` 0 = left of the first column … `columns.length` = right of the last. */
  | { kind: 'column-edge'; gutter: number; x: number }
  /** `index` counts every tab in the strip (the dragged one included). */
  | { kind: 'tab-strip'; cellId: string; index: number; lineX: number }
  | { kind: 'cell-body'; cellId: string; zone: CellZone }
  | { kind: 'empty-cell'; cellId: string }

/** Whether two hits are the same drop spot (every field equal). */
export function sameDropHit(a: WorkspaceDropHit | null, b: WorkspaceDropHit | null): boolean {
  if (a === null || b === null) return a === b
  switch (a.kind) {
    case 'column-edge': return b.kind === 'column-edge' && a.gutter === b.gutter && a.x === b.x
    case 'tab-strip': return b.kind === 'tab-strip' && a.cellId === b.cellId && a.index === b.index && a.lineX === b.lineX
    case 'cell-body': return b.kind === 'cell-body' && a.cellId === b.cellId && a.zone === b.zone
    case 'empty-cell': return b.kind === 'empty-cell' && a.cellId === b.cellId
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
  const xs = [(geo.area.left + first.rect.left) / 2]
  for (let i = 1; i < cols.length; i++) {
    const prev = cols[i - 1]
    const next = cols[i]
    if (prev && next) xs.push((prev.rect.right + next.rect.left) / 2)
  }
  xs.push((last.rect.right + geo.area.right) / 2)
  return xs
}

export function hitTestWorkspace(geo: WorkspaceGeometry, p: Point): WorkspaceDropHit | null {
  if (!inside(geo.area, p) || geo.columns.length === 0) return null

  const edges = columnEdgeXs(geo)
  const lastGutter = edges.length - 1
  for (let g = 0; g < edges.length; g++) {
    const x = edges[g]
    if (x == null) continue
    const near = g === 0
      ? p.x <= geo.area.left + EDGE_ZONE_OUTER_PX
      : g === lastGutter
        ? p.x >= geo.area.right - EDGE_ZONE_OUTER_PX
        : Math.abs(p.x - x) <= EDGE_ZONE_GUTTER_PX
    if (near) return { kind: 'column-edge', gutter: g, x }
  }

  for (const col of geo.columns) {
    if (p.x < col.rect.left || p.x > col.rect.right) continue
    for (const cell of col.cells) {
      if (!inside(cell.rect, p)) continue
      if (cell.empty) return { kind: 'empty-cell', cellId: cell.id }
      if (cell.header && inside(cell.header, p)) {
        let index = 0
        for (const t of cell.tabs) {
          if (p.x > (t.rect.left + t.rect.right) / 2) index++
        }
        const before = cell.tabs[index]
        const lastTab = cell.tabs.at(-1)
        const lineX = before
          ? before.rect.left - 1
          : lastTab ? lastTab.rect.right + 1 : cell.header.left + 4
        return { kind: 'tab-strip', cellId: cell.id, index, lineX }
      }
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
 * The layout target a hit stands for, when dragging `tabId`. Inside its own
 * strip a tab's position counts the *other* tabs (as `moveTab` expects).
 */
export function dropTargetForHit(
  layout: WorkspaceLayout,
  geo: WorkspaceGeometry,
  hit: WorkspaceDropHit,
  tabId: string,
): LayoutDropTarget | null {
  switch (hit.kind) {
    case 'column-edge': {
      const cols = geo.columns
      const right = cols[hit.gutter]
      if (right) return { kind: 'column-edge', columnId: right.id, edge: 'left' }
      const last = cols.at(-1)
      return last ? { kind: 'column-edge', columnId: last.id, edge: 'right' } : null
    }
    case 'tab-strip': {
      const loc = findTab(layout, tabId)
      const srcCell = loc ? layout.columns[loc.colIdx]?.cells[loc.cellIdx] : undefined
      const index = srcCell?.id === hit.cellId && loc && loc.tabIdx < hit.index ? hit.index - 1 : hit.index
      return { kind: 'cell', cellId: hit.cellId, index }
    }
    case 'cell-body':
      if (hit.zone === 'middle') return { kind: 'cell', cellId: hit.cellId }
      return { kind: 'cell-edge', cellId: hit.cellId, edge: hit.zone }
    case 'empty-cell':
      return { kind: 'cell', cellId: hit.cellId }
  }
}

/** Whether dropping `tabId` on `target` would change the layout. */
export function dropChangesLayout(layout: WorkspaceLayout, tabId: string, target: LayoutDropTarget): boolean {
  let n = 0
  return moveTab(layout, tabId, target, () => `probe-${++n}`) !== layout
}
