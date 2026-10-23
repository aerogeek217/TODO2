/** The panel's least width (room for a task row's columns), px. */
export const FILTER_PANEL_MIN_WIDTH = 660
/** The space kept between the panel and the window's edges, px. */
export const FILTER_PANEL_GUTTER = 16

/** Where the panel sits, in viewport px. */
export interface FilterPanelPlacement {
  left: number
  top: number
  width: number
  maxHeight: number
  /** Where the scrim starts: the top bar's bottom edge. */
  scrimTop: number
  /** The panel's top corners that lie under the tray (squared, joined to it). */
  joinedLeft: boolean
  joinedRight: boolean
}

interface Box { left: number; right: number; bottom: number }

/**
 * The panel under the tray: its top on the tray's bottom edge (overlapping
 * the tray's border by 1px, so the two share it), its left on the tray's
 * left; as wide as the tray, at least `FILTER_PANEL_MIN_WIDTH`, at most the
 * window less a gutter each side — moved left when it would cross the
 * right gutter; as tall as the window allows less a gutter.
 */
export function filterPanelPlacement(tray: Box, topBarBottom: number, vw: number, vh: number): FilterPanelPlacement {
  const width = Math.max(0, Math.min(Math.max(tray.right - tray.left, FILTER_PANEL_MIN_WIDTH), vw - 2 * FILTER_PANEL_GUTTER))
  const left = Math.max(FILTER_PANEL_GUTTER, Math.min(tray.left, vw - FILTER_PANEL_GUTTER - width))
  const top = tray.bottom - 1
  return {
    left,
    top,
    width,
    maxHeight: Math.max(0, vh - top - FILTER_PANEL_GUTTER),
    scrimTop: topBarBottom,
    joinedLeft: Math.abs(left - tray.left) < 0.5,
    joinedRight: Math.abs(left + width - tray.right) < 0.5,
  }
}
