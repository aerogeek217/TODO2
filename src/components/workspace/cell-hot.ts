import { trackHot } from '../../utils/hot-attr'

/**
 * On a workspace cell while the pointer is over it or the focus is in it:
 * what its hover-only controls show by — the controls slot's grip and ⋯
 * (`WidgetTopLine`), a strip's × and + (`CellTabStrip`). An attribute the cell keeps from its own `:hover` and
 * `:focus-within`, not those pseudo-classes in the stylesheets:
 * `utils/hot-attr` says why (cr34 H5).
 */
export const CELL_HOT_ATTR = 'data-cell-hot'

/** Keeps `data-cell-hot` on a cell's element. A callback ref's body: returns its cleanup. */
export function trackCellHot(el: HTMLElement | null): (() => void) | undefined {
  return trackHot(el, CELL_HOT_ATTR, { hover: true, focus: true })
}
