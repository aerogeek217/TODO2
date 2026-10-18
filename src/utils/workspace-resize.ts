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

export interface PairResizeInput {
  /** Measured size (px) of the first neighbour (left / above) when the drag started. */
  sizeA: number
  sizeB: number
  weightA: number
  weightB: number
  /** Pointer travel (px) since the drag started; positive grows the first neighbour. */
  delta: number
  /** Smallest size (px) either neighbour may take. */
  min: number
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

export function resizePair({ sizeA, sizeB, weightA, weightB, delta, min }: PairResizeInput): PairResizeResult {
  const pair = sizeA + sizeB
  const floor = Math.min(min, pair / 2)
  const rawA = sizeA + delta
  const rawB = sizeB - delta
  const clampedA = Math.max(floor, Math.min(pair - floor, rawA))
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
}

/**
 * A band divider drag: the divider follows the pointer, so a top band grows
 * as it goes down and a bottom band as it goes up. `height` is clamped to
 * `BAND_MIN_PX` … `max`; `raw` (unclamped) says how far past the minimum the
 * pointer went.
 */
export function resizeBand({ edge, startHeight, delta, max }: BandResizeInput): { height: number; raw: number } {
  const raw = edge === 'top' ? startHeight + delta : startHeight - delta
  return { height: Math.max(BAND_MIN_PX, Math.min(Math.max(BAND_MIN_PX, max), raw)), raw }
}
