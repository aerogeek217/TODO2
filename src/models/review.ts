/**
 * The review's shapes that are stored or shared below the stores (D26): the
 * rail's sort (item 7).
 */

/**
 * The rail's sort (item 7): the queue's own order (`queue`, the default —
 * its group dividers show only then), or by due date, next follow-up, last
 * follow-up, priority or title (`services/review-queue.reviewOrder`).
 */
export type ReviewSort = 'queue' | 'due' | 'next' | 'last' | 'priority' | 'title'

/** The sorts in menu order, with their names. */
export const REVIEW_SORTS: ReadonlyArray<{ sort: ReviewSort; label: string }> = [
  { sort: 'queue', label: 'Queue order' },
  { sort: 'due', label: 'Due' },
  { sort: 'next', label: 'Next follow-up' },
  { sort: 'last', label: 'Last follow-up' },
  { sort: 'priority', label: 'Priority' },
  { sort: 'title', label: 'Title' },
]

export function isReviewSort(v: unknown): v is ReviewSort {
  return typeof v === 'string' && REVIEW_SORTS.some((s) => s.sort === v)
}

/** A sort's name (`Queue order`, `Due`, …). */
export function reviewSortLabel(sort: ReviewSort): string {
  return REVIEW_SORTS.find((s) => s.sort === sort)?.label ?? 'Queue order'
}

/**
 * A Review widget's queue order where its tab stores none (item 12 of the
 * widget feedback): Priority.
 */
export const DEFAULT_REVIEW_WIDGET_SORT: ReviewSort = 'priority'

/**
 * The popup review's tab id: a Review widget tied to no layout tab, which a
 * Review button opens in the widget popup when the open layout has no Review
 * widget (`services/review-jump`). Its filter and session are kept under this
 * id as a tab's are; its sort and lens switch in `ui-store.popupReviewView`.
 */
export const REVIEW_POPUP_TAB_ID = 'review-popup'
