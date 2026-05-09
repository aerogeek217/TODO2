import type { TodoEvent, PersistedTodoItem } from '../../models'
import type { WeekStart } from '../../utils/effective-date'
import { resolveFuzzyOrigin } from '../../utils/effective-date'
import { MS_PER_DAY } from '../../utils/date'
import { weeklyBuckets } from './buckets'
import { isFutureShift, resolveEventDateValue } from './event-dates'

export interface ScoreMetric {
  id: 'defer' | 'completion' | 'lag'
  label: string
  unit: string
  /** One value per weekly bucket, chronological — last entry = current week. */
  values: number[]
  color: string
  lowerIsBetter: boolean
  format: (v: number) => string
  blurb: string
}

export interface DisciplineMetricsInput {
  events: readonly TodoEvent[]
  /** Required for the defer denominator (counts tasks scheduled/due in the bucket). */
  todos?: readonly PersistedTodoItem[]
  now: Date
  weekStartsOn: WeekStart
  weeks?: number
}

const DEFAULT_WEEKS = 12

/**
 * Three discipline metrics over a weekly-bucketed window of `todoEvents`:
 *  - **defer** — share of the week's planned tasks that the user pushed.
 *    Denominator: distinct todos that were scheduled or due in week N — both
 *    those still landing in the week (current `scheduledDate` / `dueDate`)
 *    AND those pushed *out of* the week during week N (a `scheduled` /
 *    `deadline` push event in week N whose `fromValue` resolves to a date in
 *    week N). Numerator: of those, the count that had ≥1 such push event.
 *    Counts tasks, not events — pushing the same task twice still counts once.
 *  - **completion** — fraction of todos whose first `scheduled.toValue` lands
 *    in week N AND who completed by `weekN.end`
 *  - **lag** — avg `(completed.timestamp - first scheduled.timestamp)` in days
 *    for todos `completed` in this week
 *
 * Empty buckets emit `0`. A bucket with `0` cohort produces a `0` for the
 * completion metric (treated as "no signal" by the UI's delta formatter); a
 * bucket with no planned tasks produces a `0` defer rate.
 *
 * Fuzzy date values (`'fuzzy:<token>'` on `fromValue` / `toValue`, or
 * `{kind: 'fuzzy', …}` on a todo's `scheduledDate`) are resolved to a concrete
 * Date by `resolveEventDateValue` / `resolveFuzzy` / `resolveFuzzyOrigin`.
 * Event-side fuzzy values use the event's `timestamp` as the as-of anchor (so
 * a `fuzzy:today` recorded Tuesday resolves to Tuesday, not whatever today is
 * when the metric runs). Todo-side fuzzy `scheduledDate` anchors on the
 * value's `setAt` stamp (the moment the user picked the token), so the defer
 * denominator attributes a "this week" picked three weeks ago to the
 * historical week, not the current one. Unknown fuzzy tokens still return
 * `null` and are skipped, but every shipped `FuzzyToken` resolves cleanly.
 */
export function selectDisciplineMetrics(input: DisciplineMetricsInput): ScoreMetric[] {
  const { events, now, weekStartsOn } = input
  const todos = input.todos ?? []
  const weeks = input.weeks ?? DEFAULT_WEEKS
  const buckets = weeklyBuckets(now, weeks, weekStartsOn)

  const firstScheduledByTodo = new Map<number, TodoEvent>()
  const earliestCompletedByTodo = new Map<number, TodoEvent>()

  for (const e of events) {
    if (e.type === 'scheduled') {
      const prev = firstScheduledByTodo.get(e.todoId)
      if (!prev || e.timestamp < prev.timestamp) firstScheduledByTodo.set(e.todoId, e)
    } else if (e.type === 'completed') {
      const prev = earliestCompletedByTodo.get(e.todoId)
      if (!prev || e.timestamp < prev.timestamp) earliestCompletedByTodo.set(e.todoId, e)
    }
  }

  const deferValues: number[] = []
  const completionValues: number[] = []
  const lagValues: number[] = []

  for (const bucket of buckets) {
    const startMs = bucket.start.getTime()
    const endMs = bucket.end.getTime()
    const inBucket = (ms: number): boolean => ms >= startMs && ms < endMs

    let lagSum = 0
    let lagN = 0
    const plannedInBucket = new Set<number>()
    const pushedFromBucket = new Set<number>()

    for (const t of todos) {
      if (t.id == null) continue
      const sched = t.scheduledDate
      if (sched) {
        let schedDate: Date | null = null
        if (sched.kind === 'date' && sched.value instanceof Date) schedDate = sched.value
        else if (sched.kind === 'fuzzy') schedDate = resolveFuzzyOrigin(sched.token, new Date(sched.setAt), weekStartsOn)
        if (schedDate && inBucket(schedDate.getTime())) plannedInBucket.add(t.id)
      }
      if (t.dueDate instanceof Date && inBucket(t.dueDate.getTime())) {
        plannedInBucket.add(t.id)
      }
    }

    for (const e of events) {
      if (e.type !== 'scheduled' && e.type !== 'deadline') continue
      const tMs = Date.parse(e.timestamp)
      if (isNaN(tMs) || !inBucket(tMs)) continue
      const asOf = new Date(tMs)
      if (!isFutureShift(e.fromValue, e.toValue, asOf, weekStartsOn)) continue
      const fromDate = resolveEventDateValue(e.fromValue, asOf, weekStartsOn)
      if (!fromDate || !inBucket(fromDate.getTime())) continue
      pushedFromBucket.add(e.todoId)
      plannedInBucket.add(e.todoId)
    }

    for (const [todoId, ce] of earliestCompletedByTodo) {
      const cMs = Date.parse(ce.timestamp)
      if (isNaN(cMs) || cMs < startMs || cMs >= endMs) continue
      const fse = firstScheduledByTodo.get(todoId)
      if (fse) {
        const fsMs = Date.parse(fse.timestamp)
        if (!isNaN(fsMs) && cMs >= fsMs) {
          lagSum += (cMs - fsMs) / MS_PER_DAY
          lagN += 1
        }
      }
    }

    const denom = plannedInBucket.size
    deferValues.push(denom > 0 ? (pushedFromBucket.size / denom) * 100 : 0)
    lagValues.push(lagN > 0 ? lagSum / lagN : 0)

    let cohort = 0
    let completedInCohort = 0
    for (const [todoId, fse] of firstScheduledByTodo) {
      const fseTs = Date.parse(fse.timestamp)
      if (isNaN(fseTs)) continue
      const target = resolveEventDateValue(fse.toValue, new Date(fseTs), weekStartsOn)
      if (target == null) continue
      const tMs = target.getTime()
      if (tMs < startMs || tMs >= endMs) continue
      cohort += 1
      const ce = earliestCompletedByTodo.get(todoId)
      if (ce) {
        const cMs = Date.parse(ce.timestamp)
        if (!isNaN(cMs) && cMs <= endMs) completedInCohort += 1
      }
    }
    completionValues.push(cohort > 0 ? (completedInCohort / cohort) * 100 : 0)
  }

  return [
    {
      id: 'defer',
      label: 'Defer rate',
      unit: '%',
      values: deferValues,
      color: 'var(--color-warning)',
      lowerIsBetter: true,
      format: (v) => Math.round(v).toString(),
      blurb: "of week's planned tasks I pushed",
    },
    {
      id: 'completion',
      label: 'On-time completion',
      unit: '%',
      values: completionValues,
      color: 'var(--color-accent)',
      lowerIsBetter: false,
      format: (v) => Math.round(v).toString(),
      blurb: 'done by end of scheduled week',
    },
    {
      id: 'lag',
      label: 'Schedule lag',
      unit: ' days',
      values: lagValues,
      color: 'var(--color-danger)',
      lowerIsBetter: true,
      format: (v) => v.toFixed(1),
      blurb: 'days from first schedule to done',
    },
  ]
}

