/**
 * Resize math for the dividers between two neighbouring workspace columns
 * (or two cells in a column). Sizes are measured pixels; weights are the
 * layout's relative shares. Only the two neighbours change: their combined
 * weight is split in proportion to their new pixel sizes, so every other
 * column / cell keeps its weight.
 */

/** Smallest column width (px). */
export const COLUMN_MIN_PX = 280
/** Smallest cell height (px): the 32px header plus an 80px body. */
export const CELL_MIN_PX = 32 + 80
/** Smallest width (px) a divider sizes a cell to beside another in its row (or band). */
export const CELL_MIN_WIDTH_PX = 120

export interface PairResizeInput {
  /** Measured size (px) of the first neighbour (left / above) when the drag started. */
  sizeA: number
  sizeB: number
  weightA: number
  weightB: number
  /** Pointer travel (px) since the drag started; positive grows the first neighbour. */
  delta: number
  /** Smallest size (px) the first neighbour may take (and the second, unless `minB` says). */
  min: number
  /** Smallest size (px) the second neighbour may take; default `min`. */
  minB?: number
}

export interface PairResizeResult {
  weightA: number
  weightB: number
  /** Clamped sizes (px). */
  sizeA: number
  sizeB: number
  /** Unclamped sizes (px) — how far past the minimum the pointer went. */
  rawA: number
  rawB: number
}

export function resizePair({ sizeA, sizeB, weightA, weightB, delta, min, minB = min }: PairResizeInput): PairResizeResult {
  const pair = sizeA + sizeB
  // Each floor is its minimum, scaled down when the pair can't hold both.
  const mins = min + minB
  const floorA = mins > pair && mins > 0 ? pair * (min / mins) : min
  const floorB = mins > pair && mins > 0 ? pair * (minB / mins) : minB
  const rawA = sizeA + delta
  const rawB = sizeB - delta
  const clampedA = Math.max(floorA, Math.min(pair - floorB, rawA))
  const clampedB = pair - clampedA
  const totalWeight = weightA + weightB
  const shareA = pair > 0 ? clampedA / pair : 0.5
  return {
    weightA: totalWeight * shareA,
    weightB: totalWeight * (1 - shareA),
    sizeA: clampedA,
    sizeB: clampedB,
    rawA,
    rawB,
  }
}

/** Double-click: the two neighbours split their combined weight evenly. */
export function evenPair(weightA: number, weightB: number): { weightA: number; weightB: number } {
  const half = (weightA + weightB) / 2
  return { weightA: half, weightB: half }
}

/** The first neighbour's share of the pair, as a whole percent (for `aria-valuenow`). */
export function pairPercent(sizeA: number, sizeB: number): number {
  const pair = sizeA + sizeB
  return pair > 0 ? Math.round((sizeA / pair) * 100) : 50
}

/**
 * What the expanded parts among `parts` (a layout's columns, a column's cells)
 * weigh together: the `flex-grow` of each is its weight over this. Weights are
 * only relative, and removing a part doesn't hand its weight on, so they may
 * sum to under 1 — and flexbox gives out only that fraction of the free space,
 * leaving the rest empty. A collapsed part takes no free space and isn't counted.
 */
export function expandedWeight(parts: readonly { weight: number; collapsed?: boolean }[]): number {
  return parts.reduce((sum, part) => (part.collapsed ? sum : sum + part.weight), 0)
}

/** Smallest height (px) of an expanded band: the header plus an 80px body. */
export const BAND_MIN_PX = CELL_MIN_PX
/** Smallest height (px) the column area between the bands keeps. */
export const COLUMN_AREA_MIN_PX = 160

export interface BandResizeInput {
  edge: 'top' | 'bottom'
  /** The band's drawn height (px) when the drag started. */
  startHeight: number
  /** Pointer travel (px) since the drag started; positive = down. */
  delta: number
  /** The tallest the band may get (px): the column area keeps its minimum. */
  max: number
  /** The smallest it may get (px); default `BAND_MIN_PX` (a band of glance widgets: `GLANCE_ROW_MIN_PX`, `workspace-rows.rowMinHeightPx`). */
  min?: number
}

/**
 * A band divider drag: the divider follows the pointer, so a top band grows
 * as it goes down and a bottom band as it goes up. `height` is clamped to
 * `min` … `max`; `raw` (unclamped) says how far past the minimum the
 * pointer went.
 */
export function resizeBand({ edge, startHeight, delta, max, min = BAND_MIN_PX }: BandResizeInput): { height: number; raw: number } {
  const raw = edge === 'top' ? startHeight + delta : startHeight - delta
  return { height: Math.max(min, Math.min(Math.max(min, max), raw)), raw }
}
