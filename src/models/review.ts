/**
 * The review's shapes that are stored or shared below the stores (D26): the
 * rail's sort (item 7) and the Review widget's pick (item 12).
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

/** What a Review widget reviews (item 12): a person's, a tag's or a status's open tasks, or one of the layout's lists as it shows. */
export type ReviewPickKind = 'person' | 'tag' | 'status' | 'list'

export const REVIEW_PICK_KINDS: readonly ReviewPickKind[] = ['person', 'tag', 'status', 'list']

export interface ReviewPick {
  kind: ReviewPickKind
  /** The person's, tag's, status's or list definition's id. */
  id: number
}

export function isReviewPick(v: unknown): v is ReviewPick {
  if (typeof v !== 'object' || v === null) return false
  const { kind, id } = v as { kind?: unknown; id?: unknown }
  return typeof kind === 'string' && (REVIEW_PICK_KINDS as readonly string[]).includes(kind)
    && typeof id === 'number' && Number.isInteger(id) && id > 0
}
