/**
 * The review's shapes that are stored or shared below the stores (D26): the
 * rail's sort (item 7) and what a Review widget reviews by (board BM).
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
 * What a Review widget reviews by (board BM): people's, tags' or statuses'
 * open tasks, or the layout's lists as they show. The kind is the widget's
 * saved setting; who or what is picked is temporary, as a list's prompt
 * pick is (`list-widget-store.picks`).
 */
export type ReviewBy = 'person' | 'tag' | 'status' | 'list'

/** The kinds in menu order. */
export const REVIEW_BY_KINDS: readonly ReviewBy[] = ['person', 'tag', 'status', 'list']

/** A new Review widget's kind. */
export const DEFAULT_REVIEW_BY: ReviewBy = 'person'

export function isReviewBy(v: unknown): v is ReviewBy {
  return typeof v === 'string' && (REVIEW_BY_KINDS as readonly string[]).includes(v)
}

/** A kind's name, as the prompt row's label and the Review by menu say it. */
export const REVIEW_BY_LABEL: Record<ReviewBy, string> = { person: 'Person', tag: 'Tag', status: 'Status', list: 'List' }

/**
 * The pick an earlier build saved in a Review widget's config (board BK:
 * one person, tag, status or list). Read only for its kind (`reviewBy`).
 */
export interface LegacyReviewPick {
  kind: ReviewBy
  id: number
}

export function isLegacyReviewPick(v: unknown): v is LegacyReviewPick {
  if (typeof v !== 'object' || v === null) return false
  const { kind, id } = v as { kind?: unknown; id?: unknown }
  return isReviewBy(kind) && typeof id === 'number' && Number.isInteger(id) && id > 0
}

/**
 * What a Review widget's config reviews by: its `by`; a config from before
 * the kind was the setting reads as its saved pick's kind (the id dropped —
 * picks aren't saved), and one with neither as Person.
 */
export function reviewBy(config: { by?: unknown; pick?: unknown }): ReviewBy {
  if (isReviewBy(config.by)) return config.by
  return isLegacyReviewPick(config.pick) ? config.pick.kind : DEFAULT_REVIEW_BY
}
