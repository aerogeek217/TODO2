/**
 * The lens control's name in the top bar's fold (`use-top-bar-fold`): its
 * text carries `LENS_NAME_ATTR`, so the fold counts the control at its
 * natural width — the name up to `LENS_NAME_MAX_WIDTH` (the CSS cap, past
 * which it is cut with an ellipsis) — and cuts it further only when even
 * the most folded bar can't hold it.
 */
export const LENS_NAME_ATTR = 'data-lens-name'
export const LENS_NAME_MAX_WIDTH = 160
