/**
 * A widget's face (D25 R): how much of it a cell has room for, picked from
 * the cell body's measured size — never stored, never a setting.
 *
 * - `small` — a glance: a title and one number (a body at most
 *   `SMALL_FACE_MAX_HEIGHT_PX` tall or `SMALL_FACE_MAX_WIDTH_PX` wide).
 * - `medium` — the number with a little behind it (a body at most
 *   `MEDIUM_FACE_MAX_HEIGHT_PX` tall).
 * - `large` — the whole widget.
 */
export type WidgetFace = 'small' | 'medium' | 'large'

/** A body this tall or shorter shows the small face. */
export const SMALL_FACE_MAX_HEIGHT_PX = 90
/** A body this narrow or narrower shows the small face. */
export const SMALL_FACE_MAX_WIDTH_PX = 180
/** A body this tall or shorter (and not small) shows the medium face. */
export const MEDIUM_FACE_MAX_HEIGHT_PX = 160

/**
 * The face for a body of `size`. Unmeasured (0 × 0: before the first layout,
 * or without ResizeObserver) is `large`, so nothing flashes small first.
 */
export function widgetFaceFor(size: { width: number; height: number }): WidgetFace {
  const { width, height } = size
  if (width <= 0 && height <= 0) return 'large'
  if (height <= SMALL_FACE_MAX_HEIGHT_PX || width <= SMALL_FACE_MAX_WIDTH_PX) return 'small'
  if (height <= MEDIUM_FACE_MAX_HEIGHT_PX) return 'medium'
  return 'large'
}

/**
 * A Review widget's body this tall or shorter (and not small) shows its medium face. Above it the large
 * face — the queue beside the card — shows, and both scroll: under about 530px the card has no room to
 * pin its dock (the update line and the two follow-up rows, 120px of writing, the top line, the prompt
 * row, the title and the footer), so its body scrolls as one (`Review.module.css`, `review-card`). At
 * this height the top line, the prompt row, the title and the footer leave about 110px of card.
 */
export const REVIEW_MEDIUM_MAX_HEIGHT_PX = 320
/** A Review widget's body this narrow or narrower (and not small) shows its medium face: the card's rail beside its writing needs it. */
export const REVIEW_MEDIUM_MAX_WIDTH_PX = 640

/**
 * Under this width (a Review widget's body) the queue column folds away and the
 * Queue button opens it as a popover: the queue's narrowest (220px) beside the card's
 * narrowest two-column layout (600px). Unmeasured (0) never folds.
 */
export const REVIEW_QUEUE_FOLD_PX = 820

/** Whether a review of `width` folds its queue away (`REVIEW_QUEUE_FOLD_PX`). */
export function reviewQueueFolds(width: number): boolean {
  return width > 0 && width < REVIEW_QUEUE_FOLD_PX
}

/**
 * A Review widget's face (item 12): small as every widget's; medium — the
 * card's essentials — while the body is too narrow for the card's two
 * columns or too short for the queue and a scrolling card
 * (`REVIEW_MEDIUM_MAX_*`); else large. Unmeasured is `large`.
 */
export function reviewFaceFor(size: { width: number; height: number }): WidgetFace {
  const face = widgetFaceFor(size)
  if (face !== 'large') return face
  const { width, height } = size
  if (width <= 0 && height <= 0) return 'large'
  return height <= REVIEW_MEDIUM_MAX_HEIGHT_PX || width <= REVIEW_MEDIUM_MAX_WIDTH_PX ? 'medium' : 'large'
}
