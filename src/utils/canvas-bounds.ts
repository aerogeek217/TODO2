import { useSettingsStore } from '../stores/settings-store'

/**
 * Hard limit on persisted canvas widget coordinates. Both axes are clamped
 * to [-N, N] at every position-write site (project / list-inset / floating-*
 * stores). Configurable via Settings → Canvas → "Canvas extent (px)".
 *
 * Background: drag-math, cascade-shift, or rare programmatic spawn paths
 * have produced positions in the tens of thousands of pixels, which then
 * blow up `fitView` (the bounds get so wide that even at React Flow's
 * `minZoom=0.2` the viewport centers on empty space between clusters and
 * nothing renders). The clamp is the floor — no widget can drift outside
 * the band regardless of upstream bug.
 */
export const DEFAULT_CANVAS_MAX_EXTENT = 10000
export const MIN_CANVAS_MAX_EXTENT = 1000
export const MAX_CANVAS_MAX_EXTENT = 100000

export function isValidCanvasMaxExtent(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    n >= MIN_CANVAS_MAX_EXTENT &&
    n <= MAX_CANVAS_MAX_EXTENT
  )
}

/** Read the current limit from the settings store. */
export function getCanvasMaxExtent(): number {
  const v = useSettingsStore.getState().canvasMaxExtent
  return isValidCanvasMaxExtent(v) ? v : DEFAULT_CANVAS_MAX_EXTENT
}

/**
 * Clamp a single (x, y) pair to the configured canvas extent. Caller may
 * pass an explicit `max` to bypass the settings-store read (useful in tests
 * and inside batch loops where the limit is hoisted once).
 */
export function clampCanvasPosition(x: number, y: number, max?: number): { x: number; y: number } {
  const limit = max ?? getCanvasMaxExtent()
  return {
    x: Math.max(-limit, Math.min(limit, x)),
    y: Math.max(-limit, Math.min(limit, y)),
  }
}
