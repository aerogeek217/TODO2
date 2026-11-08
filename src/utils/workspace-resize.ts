/**
 * The smallest sizes a divider (and the table's tracks, `workspace-table`)
 * keep a workspace cell at, and a divider's value for assistive tech.
 */

/** Smallest cell height (px): the 32px header plus an 80px body (a glance cell's: `workspace-rows.GLANCE_ROW_MIN_PX`). */
export const CELL_MIN_PX = 32 + 80
/** Smallest cell width (px). */
export const CELL_MIN_WIDTH_PX = 120

/** The first of two sizes' share of both, as a whole percent (a divider's `aria-valuenow`). */
export function pairPercent(sizeA: number, sizeB: number): number {
  const pair = sizeA + sizeB
  return pair > 0 ? Math.round((sizeA / pair) * 100) : 50
}
