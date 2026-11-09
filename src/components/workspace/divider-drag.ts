import type { GridAxis, LayoutBody } from '../../models/workspace-layout'
import type { MoveEdgeOptions } from '../../utils/workspace-layout-ops'
import { cellById, spanOf } from '../../utils/workspace-grid'
import { cellMinPx, tableTrackSizes, trackStart } from '../../utils/workspace-table'

/**
 * What the table's resize handles share — a divider (`WorkspaceDivider`)
 * and a crossing handle (`WorkspaceCrossing`): the tracks as drawn, the
 * cells' minimums and throwaway ids for a preview's probe.
 */

/** Keyboard step for a focused divider or crossing handle (px). */
export const KEY_STEP_PX = 16

/** The table's tracks along `axis` as drawn (px), from its computed grid template. */
export function drawnSizes(table: HTMLElement, axis: GridAxis): number[] {
  const style = getComputedStyle(table)
  const template = axis === 'columns' ? style.gridTemplateColumns : style.gridTemplateRows
  return template.split(' ').map((v) => Number.parseFloat(v)).filter((n) => Number.isFinite(n))
}

/** Each cell's minimum along an axis (`workspace-table.cellMinPx`: a collapsed cell's is its header). */
export function minPxIn(layout: LayoutBody): MoveEdgeOptions['minPx'] {
  return (cell, axis) => cellMinPx(layout, cell, axis)
}

/** Throwaway ids for a preview's probe (never stored). */
export function probeIds(): () => string {
  let n = 0
  return () => `probe-${++n}`
}

/** What a preview of a structural move needs from the drag's start: the table's room and gap along the axis, its rows' drawn heights and the tracks' sizes. */
export interface PreviewBasis {
  available: number
  gap: number
  rowPx: ReadonlyMap<string, number>
  sizes: readonly number[]
}

/**
 * The px offset along `axis` that line `line` moves to in `next` from where
 * it was at the drag's start, read off cell `cellId` (which ends on it
 * before and after: it keeps its id): a preview of a move that changes the
 * structure. `fallback` when that cell is gone.
 */
export function previewOffset(basis: PreviewBasis, axis: GridAxis, line: number, next: LayoutBody, cellId: string, fallback: number): number {
  const cell = cellById(next, cellId)
  if (!cell) return fallback
  const sizes = tableTrackSizes(next, axis, basis.available, basis.gap, basis.rowPx)
  const at = trackStart(sizes, spanOf(cell.area, axis)[1], basis.gap)
  return at - trackStart(basis.sizes, line, basis.gap)
}
