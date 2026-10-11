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
