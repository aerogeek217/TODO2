/** Created vs completed's axis: its column gap (`.trendAxis`), a label character's width at 12px, the room between two labels. */
const AXIS_GAP_PX = 4
const AXIS_CHAR_PX = 7
const AXIS_SPACE_PX = 6

/**
 * Every how many buckets the axis labels one, so labels of `labelChars`
 * characters never collide across `count` equal columns `width` px wide
 * (unmeasured: every one). The labels are counted back from the last bucket,
 * today's, which always has one.
 */
export function trendAxisStep(width: number, count: number, labelChars: number): number {
  if (width <= 0 || count <= 1) return 1
  const pitch = (width - AXIS_GAP_PX * (count - 1)) / count + AXIS_GAP_PX
  return Math.max(1, Math.ceil((labelChars * AXIS_CHAR_PX + AXIS_SPACE_PX) / pitch))
}
