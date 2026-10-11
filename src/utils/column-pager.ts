/**
 * Geometry for the mobile workspace's column pager: columns sit side by side,
 * one page (the pager's width) each, separated by a fixed gap, and the column
 * strip's underline follows the scroll position.
 */

/** Horizontal extent of one item in the column strip. */
export interface StripBox {
  left: number
  width: number
}

/**
 * Fractional column index for a pager scroll position: `1.5` is halfway
 * between the second and third column. Clamped to `[0, count - 1]`.
 */
export function pagerPosition(scrollLeft: number, pageWidth: number, gap: number, count: number): number {
  if (count <= 1 || pageWidth <= 0) return 0
  const pos = scrollLeft / (pageWidth + gap)
  return Math.min(Math.max(pos, 0), count - 1)
}

/** Scroll offset that shows column `index`. */
export function pageOffset(index: number, pageWidth: number, gap: number): number {
  return Math.max(index, 0) * (pageWidth + gap)
}

/**
 * Where the strip underline sits at fractional position `pos`: interpolated
 * between the two strip items either side of it, so it slides with a swipe.
 */
export function indicatorBox(items: readonly StripBox[], pos: number): StripBox | null {
  if (items.length === 0) return null
  const clamped = Math.min(Math.max(pos, 0), items.length - 1)
  const i = Math.floor(clamped)
  const from = items[i]
  if (!from) return null
  const to = items[i + 1] ?? from
  const f = clamped - i
  return {
    left: from.left + (to.left - from.left) * f,
    width: from.width + (to.width - from.width) * f,
  }
}
