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

/**
 * Floor for `<ReactFlow minZoom>`. Hard clamp in case the formula produces
 * something absurd; at zoom < 0.005 a ProjectNode renders at < 2 px so manual
 * zoom-out beyond this is meaningless even on huge canvases.
 */
export const ABSOLUTE_MIN_ZOOM = 0.02

/**
 * Default ceiling — matches React Flow's prior hardcoded `minZoom={0.2}`.
 * Small canvases (extent < ~2700) keep this so widgets stay legible at the
 * bottom of the zoom range.
 */
export const DEFAULT_MIN_ZOOM = 0.2

/**
 * Derive React Flow's `minZoom` from the configured canvas extent so a
 * `fitView` against a fully-saturated band (widgets at ±maxExtent) is
 * always reachable, AND manual zoom-out can match.
 *
 * Math: viewport width / (2 × maxExtent × padding), where the constants
 * assume a ~1280 px desktop viewport and `fitView({ padding: 0.15 })`
 * (configured in `CanvasPage`). Smaller viewports clamp earlier — fitView
 * still recenters on the bounds center so content stays on screen.
 */
export function deriveCanvasMinZoom(maxExtent: number, viewportWidth = 1280): number {
  const FIT_PADDING_FACTOR = 1.15
  const required = viewportWidth / (2 * maxExtent * FIT_PADDING_FACTOR)
  return Math.max(ABSOLUTE_MIN_ZOOM, Math.min(DEFAULT_MIN_ZOOM, required))
}
