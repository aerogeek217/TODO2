import { useMemo } from 'react'
import { emptyPredicate, type TodoPredicate } from '../models'
import { REVIEW_SWEEPS, type ReviewSweepId } from '../services/review'
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

/** The open tasks of `shown` the predicate keeps (unordered). */
function kept(base: StatsBase, predicate: TodoPredicate) {
  const criteria = criteriaMemo(predicate)
  return base.shown.filter((t) => !t.isCompleted && matchesFilterWithLookups(criteria, t, base.lookups, base.ctx.today, base.markerSettings))
}

/** The open tasks of `shown` the predicate keeps, in `sortOrder`. */
function filteredIds(base: StatsBase, predicate: TodoPredicate): number[] {
  return kept(base, predicate).sort(bySortOrder).map((t) => t.id)
}

/** Each sweep's filter as a predicate (the sweeps are constants). */
const SWEEP_PREDICATES = REVIEW_SWEEPS.map((s) => ({ id: s.id, predicate: reviewFilterPredicate(s.filter) }))

/**
 * How many tasks each of the Review field's sweeps (`REVIEW_SWEEPS`) would
 * queue: counted as the queue is, over the same base (the screen filter's
 * open tasks, Settings' Stale after and due-soon range read live).
 */
export function reviewSweepCounts(base: StatsBase): Map<ReviewSweepId, number> {
  return new Map(SWEEP_PREDICATES.map(({ id, predicate }) => [id, kept(base, predicate).length]))
}

/** {@link reviewSweepCounts}, kept current with the tasks, the screen filter and Settings. */
export function useReviewSweepCounts(): ReadonlyMap<ReviewSweepId, number> {
  const base = useStatsBase()
  return useMemo(() => reviewSweepCounts(base), [base])
}

/** The queue of `filter` (none: an empty queue). Pass the same object while the filter is the same (the store's). */
export function useReviewWidgetQueue(filter: ReviewFilter | null | undefined): ReviewWidgetQueue {
  const predicate = useMemo(() => (filter ? reviewFilterPredicate(filter) : null), [filter])
  const base = useStatsBase()
  const ids = useMemo(() => (predicate ? filteredIds(base, predicate) : NO_IDS), [base, predicate])
  return useMemo<ReviewWidgetQueue>(() => (predicate ? { ids } : NO_QUEUE), [predicate, ids])
}
