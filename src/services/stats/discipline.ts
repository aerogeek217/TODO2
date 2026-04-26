import type { TodoEvent, PersistedTodoItem } from '../../models'
import type { WeekStart } from '../../utils/effective-date'
import { MS_PER_DAY } from '../../utils/date'
import { weeklyBuckets } from './buckets'

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
  /** Carried for parity with the plan signature; not consumed by v1 metrics. */
  todos?: readonly PersistedTodoItem[]
  now: Date
  weekStartsOn: WeekStart
  weeks?: number
}

const DEFAULT_WEEKS = 12

/**
 * Three discipline metrics over a weekly-bucketed window of `todoEvents`:
 *  - **defer** — avg `scheduled` event count per todo `completed` in this week
 *  - **completion** — fraction of todos whose first `scheduled.toValue` lands
 *    in week N AND who completed by `weekN.end`
 *  - **lag** — avg `(completed.timestamp - first scheduled.timestamp)` in days
 *    for todos `completed` in this week
 *
 * Empty buckets emit `0`. A bucket with `0` cohort produces a `0` for the
 * completion metric (treated as "no signal" by the UI's delta formatter).
 *
 * Fuzzy `scheduled.toValue` (`'fuzzy:<token>'`) does NOT contribute to the
 * completion cohort — we don't store the as-of date so we can't resolve the
 * token retroactively.
 */
export function selectDisciplineMetrics(input: DisciplineMetricsInput): ScoreMetric[] {
  const { events, now, weekStartsOn } = input
  const weeks = input.weeks ?? DEFAULT_WEEKS
  const buckets = weeklyBuckets(now, weeks, weekStartsOn)

  const scheduledCountByTodo = new Map<number, number>()
  const firstScheduledByTodo = new Map<number, TodoEvent>()
  const earliestCompletedByTodo = new Map<number, TodoEvent>()

  for (const e of events) {
    if (e.type === 'scheduled') {
      scheduledCountByTodo.set(e.todoId, (scheduledCountByTodo.get(e.todoId) ?? 0) + 1)
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

    let deferSum = 0
    let deferN = 0
    let lagSum = 0
    let lagN = 0

    for (const [todoId, ce] of earliestCompletedByTodo) {
      const cMs = Date.parse(ce.timestamp)
      if (isNaN(cMs) || cMs < startMs || cMs >= endMs) continue
      deferSum += scheduledCountByTodo.get(todoId) ?? 0
      deferN += 1

      const fse = firstScheduledByTodo.get(todoId)
      if (fse) {
        const fsMs = Date.parse(fse.timestamp)
        if (!isNaN(fsMs) && cMs >= fsMs) {
          lagSum += (cMs - fsMs) / MS_PER_DAY
          lagN += 1
        }
      }
    }

    deferValues.push(deferN > 0 ? deferSum / deferN : 0)
    lagValues.push(lagN > 0 ? lagSum / lagN : 0)

    let cohort = 0
    let completedInCohort = 0
    for (const [todoId, fse] of firstScheduledByTodo) {
      if (typeof fse.toValue !== 'string') continue
      const target = parseEventDateValue(fse.toValue)
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
      unit: '×',
      values: deferValues,
      color: 'var(--color-warning)',
      lowerIsBetter: true,
      format: (v) => v.toFixed(1),
      blurb: 'reschedules per completed task',
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

function parseEventDateValue(v: string): Date | null {
  if (v.startsWith('fuzzy:')) return null
  const t = Date.parse(v)
  return isNaN(t) ? null : new Date(t)
}
