import { FILTER_PANEL_GUTTER } from '../overlays/filter-panel-placement'

/** Where the expanded tray sits, in viewport px. */
export interface TrayExpansion {
  left: number
  width: number
}

/**
 * The filter tray expanded over the top bar to show every filter button
 * (while the filtered-tasks panel is open and the bar has the filters
 * folded): from its own left edge (`left`) rightwards, `width` wide (the
 * tray with its filter buttons) — slid left only as far as the window's
 * right gutter needs, never past the left one. `null` when even the window
 * less its gutters (the filtered-tasks panel's) can't hold it: the filters
 * stay folded.
 */
export function trayExpansion(left: number, width: number, viewportWidth: number, gutter = FILTER_PANEL_GUTTER): TrayExpansion | null {
  if (width > viewportWidth - 2 * gutter) return null
  return { left: Math.max(gutter, Math.min(left, viewportWidth - gutter - width)), width }
}
