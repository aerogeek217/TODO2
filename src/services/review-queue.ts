import type { PersistedTodoItem } from '../models'
import { useSettingsStore } from '../stores/settings-store'
import { useTodoStore } from '../stores/todo-store'
import {
  currentReviewId,
  type ReviewDivider,
  type ReviewPlace,
  type ReviewSession,
  type ReviewSessionData,
  type ReviewSort,
} from '../stores/review-session'
import { startOfToday } from '../utils/date'
import { pickTodoDate, type TodoSortDateField } from '../utils/effective-date'
import { priorityRank } from '../utils/markers'
import type { UrgentDueWithinDays } from '../utils/urgency'

/**
 * A review's queue and stepping (D26), the Review widget's
 * alike: the rail's sort (item 7) and a new queue put in with the place
 * kept (a lens toggle, a deleted task, a live queue's change). Pure parts
 * first; then the writers over a session (`review-session`).
 */

/** What a sort reads besides the ids. */
export interface ReviewOrderEnv {
  todoById: ReadonlyMap<number, PersistedTodoItem>
  today: Date
  urgentRange: UrgentDueWithinDays
}

/** Each date sort's date, as a list sorts by it (`utils/effective-date.pickTodoDate`). */
const SORT_DATE: Record<'due' | 'next' | 'last', TodoSortDateField> = {
  due: 'deadline',
  next: 'followup',
  last: 'lastFollowup',
}

/** Two dates, earliest first, none last. */
function compareDates(a: Date | null, b: Date | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return a.getTime() - b.getTime()
}

/** `sort`'s comparison (0 for a tie, which the queue's order breaks). */
function sortComparator(sort: Exclude<ReviewSort, 'queue'>, env: ReviewOrderEnv): (a: PersistedTodoItem, b: PersistedTodoItem) => number {
  switch (sort) {
    case 'title':
      return (a, b) => a.title.localeCompare(b.title)
    case 'priority': {
      const rank = new Map<number, number>()
      const rankOf = (t: PersistedTodoItem) => {
        let r = rank.get(t.id)
        if (r === undefined) rank.set(t.id, (r = priorityRank(t, env.today, env.urgentRange)))
        return r
      }
      return (a, b) => (rankOf(a) - rankOf(b)) || compareDates(pickTodoDate(a, 'deadline'), pickTodoDate(b, 'deadline'))
    }
    default: {
      const field = SORT_DATE[sort]
      return (a, b) => compareDates(pickTodoDate(a, field), pickTodoDate(b, field))
    }
  }
}

/**
 * `ids` in `sort`'s order: the queue's own (`queue`); by due date or next
 * follow-up (soonest first, none last), last follow-up (oldest first, never
 * followed up last), priority (Focus, Urgent + Important, Urgent —
 * a due date in Settings' urgent range counts —, Important, none; then due
 * date) or title (A–Z) — the keys a list sorts by. Ties keep the queue's
 * order; a task not loaded keeps its queue place at the end.
 */
export function reviewOrder(ids: readonly number[], sort: ReviewSort, env: ReviewOrderEnv): number[] {
  if (sort === 'queue') return [...ids]
  const compare = sortComparator(sort, env)
  const queueIndex = new Map(ids.map((id, i) => [id, i]))
  const known = ids.flatMap((id) => {
    const t = env.todoById.get(id)
    return t ? [t] : []
  })
  const unknown = ids.filter((id) => !env.todoById.has(id))
  known.sort((a, b) => compare(a, b) || (queueIndex.get(a.id) ?? 0) - (queueIndex.get(b.id) ?? 0))
  return [...known.map((t) => t.id), ...unknown]
}

/**
 * Where the review stands after its queue becomes `next`: on the current
 * task while it is still in the order — or, with `keepCurrent` (a live
 * queue), while it still exists (`exists`), kept in the order at its place
 * until the review moves on —, else on the task after it in the old order
 * that is still there, else the one before it, else the first.
 */
export function keepPlace(
  old: Pick<ReviewSessionData, 'order' | 'index'>,
  next: readonly number[],
  opts: { keepCurrent?: boolean; exists?: (id: number) => boolean } = {},
): { order: number[]; index: number } {
  const order = [...next]
  const current = currentReviewId(old)
  if (current == null || (order.length === 0 && !(opts.keepCurrent && opts.exists?.(current)))) {
    return { order, index: 0 }
  }
  const at = order.indexOf(current)
  if (at >= 0) return { order, index: at }
  const inNext = new Set(order)
  if (opts.keepCurrent && opts.exists?.(current)) {
    // Kept where it was: before the first task after it (in the old order) that is still there.
    const after = old.order.slice(old.index + 1).find((id) => inNext.has(id))
    const place = after != null ? order.indexOf(after) : order.length
    order.splice(place, 0, current)
    return { order, index: place }
  }
  const after = old.order.slice(old.index + 1).find((id) => inNext.has(id))
  if (after != null) return { order, index: order.indexOf(after) }
  const before = old.order.slice(0, old.index).reverse().find((id) => inNext.has(id))
  return { order, index: before != null ? order.indexOf(before) : 0 }
}

/** The order env as the stores have it now. */
export function currentReviewOrderEnv(): ReviewOrderEnv {
  return {
    todoById: new Map(useTodoStore.getState().todos.map((t) => [t.id, t])),
    today: startOfToday(),
    urgentRange: useSettingsStore.getState().urgentDueWithinDays,
  }
}

/** A session as the writers below need it. */
type SessionLike = { getState: () => Pick<ReviewSession, keyof ReviewSessionData | 'place'> }

/**
 * Sorts the rail by `sort` (item 7): the order taken now from the tasks as
 * they are (it doesn't move while the review edits them), the current task
 * staying current.
 */
export function setReviewSort(session: SessionLike, sort: ReviewSort, env: ReviewOrderEnv = currentReviewOrderEnv()): void {
  const s = session.getState()
  if (s.sort === sort) return
  const sorted = reviewOrder(s.ids, sort, env)
  // A current task kept after it left a live queue stays kept.
  const { order, index } = keepPlace(s, sorted, { keepCurrent: true, exists: (id) => s.order.includes(id) })
  s.place({ ids: s.ids, dividers: s.dividers, sort, order, index })
}

/**
 * Puts a new queue into the session (a lens toggle, a live queue's change):
 * sorted by its sort, the place kept (`keepPlace`; `keepCurrent` — a live
 * queue — keeps a current task that left it until the review moves on).
 */
export function setReviewQueue(
  session: SessionLike,
  queue: { ids: readonly number[]; dividers?: readonly ReviewDivider[] },
  opts: { keepCurrent?: boolean; env?: ReviewOrderEnv } = {},
): void {
  const env = opts.env ?? currentReviewOrderEnv()
  const s = session.getState()
  const sorted = reviewOrder(queue.ids, s.sort, env)
  const { order, index } = keepPlace(s, sorted, { keepCurrent: opts.keepCurrent, exists: (id) => env.todoById.has(id) })
  const place: ReviewPlace = { ids: queue.ids, dividers: queue.dividers ?? [], sort: s.sort, order, index }
  s.place(place)
}
