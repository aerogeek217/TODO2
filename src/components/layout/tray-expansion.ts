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
 * tray with its filter buttons) up to the window's right gutter — shrunk
 * there first (to no less than `minWidth`, the tray shrunk as far as it
 * goes), then slid left only as far as that needs, never past the left
 * gutter. `null` when even the window less its gutters (the filtered-tasks
 * panel's) can't hold it shrunk: the filters stay folded.
 */
export function trayExpansion(
  left: number,
  width: number,
  viewportWidth: number,
  minWidth = width,
  gutter = FILTER_PANEL_GUTTER,
): TrayExpansion | null {
  const least = Math.min(minWidth, width)
  const right = viewportWidth - gutter
  if (least > right - gutter) return null
  if (left + width <= right) return { left, width }
  if (left + least <= right) return { left, width: right - left }
  return { left: Math.max(gutter, right - least), width: least }
}
