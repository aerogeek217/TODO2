import type { SlotKind } from '../models/canvas-rails'

/**
 * Default width/height for each floating widget kind. Spawn / pop-out / convert
 * paths read these to size a fresh widget; resize handles overwrite the row's
 * `width` / `height` columns from there.
 *
 * Kept in its own module (rather than colocated with `FLOAT_KIND_REGISTRY`) so
 * the eight floating-* stores can import these without importing the full
 * registry — the registry references each store's hook in its arrow-function
 * bodies, and a store importing the registry would create a cyclic ES module
 * graph.
 */
export const FLOAT_DEFAULT_RECTS: Record<SlotKind, { width: number; height: number }> = {
  lens: { width: 320, height: 300 },
  notes: { width: 240, height: 200 },
  calendar: { width: 380, height: 320 },
  taskboard: { width: 320, height: 400 },
  horizons: { width: 520, height: 360 },
  status: { width: 380, height: 240 },
  scoreboard: { width: 720, height: 280 },
  snoozeGraveyard: { width: 380, height: 240 },
}
