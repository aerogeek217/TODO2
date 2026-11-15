import { useMemo } from 'react'
import { emptyPredicate, type TodoPredicate } from '../models'
import type { ReviewFilter } from '../stores/list-widget-store'
import { predicateToCriteria } from '../utils/filter-criteria'
import { matchesFilterWithLookups } from '../utils/filter-match'
import { withExpression } from '../utils/predicate-expression'
import { sharedMemoByKey } from '../utils/shared-memo'
import { bySortOrder } from '../utils/sort-order'
import { useStatsBase, type StatsBase } from './use-glance-data'

/**
 * A Review widget's live queue (widget feedback 2A): the open tasks its
 * filter keeps — the expression typed into its field — under the screen
 * filter, in `sortOrder`. Kept current as the tasks change: a task leaving
 * the filter leaves the queue. No dividers: the queue is one run of tasks.
 */
interface ReviewWidgetQueue {
  ids: number[]
}

const NO_IDS: number[] = []
const NO_QUEUE: ReviewWidgetQueue = { ids: NO_IDS }

/** A Review widget's filter as the predicate the queue matches (its `done` kept: the queue takes open tasks either way). */
export function reviewFilterPredicate(filter: ReviewFilter): TodoPredicate {
  return withExpression(emptyPredicate(), filter.expression, filter.showCompleted)
}

/** Each predicate's criteria, the same object while the predicate is. */
const criteriaMemo = sharedMemoByKey(function criteria(predicate: TodoPredicate) {
  return predicateToCriteria(predicate)
})

/** The open tasks of `shown` the predicate keeps, in `sortOrder`. */
function filteredIds(base: StatsBase, predicate: TodoPredicate): number[] {
  const criteria = criteriaMemo(predicate)
  return base.shown
    .filter((t) => !t.isCompleted && matchesFilterWithLookups(criteria, t, base.lookups, base.ctx.today, base.markerSettings))
    .sort(bySortOrder)
    .map((t) => t.id)
}

/** The queue of `filter` (none: an empty queue). Pass the same object while the filter is the same (the store's). */
export function useReviewWidgetQueue(filter: ReviewFilter | null | undefined): ReviewWidgetQueue {
  const predicate = useMemo(() => (filter ? reviewFilterPredicate(filter) : null), [filter])
  const base = useStatsBase()
  const ids = useMemo(() => (predicate ? filteredIds(base, predicate) : NO_IDS), [base, predicate])
  return useMemo<ReviewWidgetQueue>(() => (predicate ? { ids } : NO_QUEUE), [predicate, ids])
}
