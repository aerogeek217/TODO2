import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem, TodoEvent } from '../../../models'
import type { ScheduledValue } from '../../../models/scheduled-value'
import { selectDisciplineMetrics } from '../../../services/stats/discipline'
import { weeklyBuckets } from '../../../services/stats/buckets'

// Use local-time dates so bucket math (which goes through `startOfDay` /
// `startOfWeek`, both timezone-local) and event-timestamp parsing (UTC) line
// up regardless of CI timezone. `new Date(y, m, d)` constructs a local-midnight
// Date; `.toISOString()` then writes the UTC equivalent that `Date.parse`
// will round-trip back to the same instant.
const NOW = new Date(2026, 3, 13, 12, 0, 0) // local Monday afternoon, 2026-04-13
const localISO = (year: number, month0: number, day: number, hour = 12) =>
  new Date(year, month0, day, hour).toISOString()

function ev(overrides: Partial<TodoEvent> & Pick<TodoEvent, 'todoId' | 'type' | 'timestamp'>): TodoEvent {
  return {
    fromValue: null,
    toValue: null,
    ...overrides,
  }
}

let nextTodoId = 1
function makeTodo(
  fields: Partial<PersistedTodoItem> & { id?: number; scheduledDate?: ScheduledValue; dueDate?: Date } = {},
): PersistedTodoItem {
  return {
    id: fields.id ?? nextTodoId++,
    title: fields.title ?? 't',
    isCompleted: fields.isCompleted ?? false,
    createdAt: fields.createdAt ?? new Date(2026, 0, 1),
    modifiedAt: fields.modifiedAt ?? new Date(2026, 0, 1),
    sortOrder: fields.sortOrder ?? 0,
    ...fields,
  } as PersistedTodoItem
}
function schedDate(d: Date): ScheduledValue {
  return { kind: 'date', value: d }
}

describe('weeklyBuckets', () => {
  it('returns N consecutive non-overlapping weekly windows ending in the week of `now`', () => {
    const buckets = weeklyBuckets(NOW, 12, 1)
    expect(buckets).toHaveLength(12)
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]!.start.getTime()).toBe(buckets[i - 1]!.end.getTime())
    }
    const last = buckets[buckets.length - 1]!
    expect(last.start.getTime()).toBeLessThanOrEqual(NOW.getTime())
    expect(last.end.getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('honors weekStartsOn=0 vs 1 by shifting bucket boundaries', () => {
    const sunBuckets = weeklyBuckets(NOW, 4, 0)
    const monBuckets = weeklyBuckets(NOW, 4, 1)
    expect(sunBuckets[0]!.start.getDay()).toBe(0)
    expect(monBuckets[0]!.start.getDay()).toBe(1)
  })

  it('returns [] when weeks <= 0', () => {
    expect(weeklyBuckets(NOW, 0, 1)).toEqual([])
    expect(weeklyBuckets(NOW, -3, 1)).toEqual([])
  })
})

describe('selectDisciplineMetrics', () => {
  it('returns three metrics in defer / completion / lag order with stable ids', () => {
    const out = selectDisciplineMetrics({ events: [], now: NOW, weekStartsOn: 1 })
    expect(out.map((m) => m.id)).toEqual(['defer', 'completion', 'lag'])
    expect(out[0]!.lowerIsBetter).toBe(true)
    expect(out[1]!.lowerIsBetter).toBe(false)
    expect(out[2]!.lowerIsBetter).toBe(true)
  })

  it('emits one value per bucket — 12 by default, configurable via weeks', () => {
    const def = selectDisciplineMetrics({ events: [], now: NOW, weekStartsOn: 1 })
    expect(def[0]!.values).toHaveLength(12)

    const five = selectDisciplineMetrics({ events: [], now: NOW, weekStartsOn: 1, weeks: 5 })
    expect(five[0]!.values).toHaveLength(5)
  })

  it('empty event stream produces all-zero values across every bucket', () => {
    const out = selectDisciplineMetrics({ events: [], now: NOW, weekStartsOn: 1, weeks: 4 })
    for (const m of out) {
      expect(m.values.every((v) => v === 0)).toBe(true)
    }
  })

  it('defer = pushed-from-week tasks / (currently sched+due in week ∪ pushed-from-week)', () => {
    // Week of Mon 2026-04-13: 10 tasks scheduled or due in the week —
    //   - 7 still scheduled in the week (no push)
    //   - 3 pushed away during the week (push event with fromValue ∈ week, toValue > week)
    // Expected denom = 10 (7 still + 3 pushed-away), numerator = 3 → 30%.
    const todos: PersistedTodoItem[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeTodo({ id: 100 + i, scheduledDate: schedDate(new Date(2026, 3, 15)) })),
      ...Array.from({ length: 2 }, (_, i) =>
        makeTodo({ id: 200 + i, dueDate: new Date(2026, 3, 16) })),
    ]
    const events: TodoEvent[] = [
      ev({ todoId: 300, type: 'scheduled', timestamp: localISO(2026, 3, 14, 10), fromValue: localISO(2026, 3, 15), toValue: localISO(2026, 3, 22) }),
      ev({ todoId: 301, type: 'scheduled', timestamp: localISO(2026, 3, 14, 11), fromValue: localISO(2026, 3, 16), toValue: localISO(2026, 3, 23) }),
      ev({ todoId: 302, type: 'deadline',  timestamp: localISO(2026, 3, 14, 12), fromValue: localISO(2026, 3, 17), toValue: localISO(2026, 3, 24) }),
    ]
    const out = selectDisciplineMetrics({ events, todos, now: NOW, weekStartsOn: 1, weeks: 1 })
    expect(out[0]!.values[0]).toBe(30)
  })

  it('defer dedupes a task counted by both current state and a push-away event', () => {
    // Task pushed within the week (fromValue ∈ week, toValue still ∈ week, just later).
    // Currently scheduled in week AND has push-from-week event → counted once.
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1, scheduledDate: schedDate(new Date(2026, 3, 18)) }),
    ]
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 14, 10), fromValue: localISO(2026, 3, 14), toValue: localISO(2026, 3, 18) }),
    ]
    const out = selectDisciplineMetrics({ events, todos, now: NOW, weekStartsOn: 1, weeks: 1 })
    expect(out[0]!.values[0]).toBe(100)
  })

  it('defer counts deadline pushes the same as scheduled pushes', () => {
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1, dueDate: new Date(2026, 3, 15) }),
      makeTodo({ id: 2, dueDate: new Date(2026, 3, 16) }),
    ]
    const events: TodoEvent[] = [
      ev({ todoId: 2, type: 'deadline', timestamp: localISO(2026, 3, 14, 10), fromValue: localISO(2026, 3, 16), toValue: localISO(2026, 3, 22) }),
    ]
    const out = selectDisciplineMetrics({ events, todos, now: NOW, weekStartsOn: 1, weeks: 1 })
    expect(out[0]!.values[0]).toBe(50)
  })

  it('defer ignores pushes whose fromValue is not in the bucket', () => {
    // A task scheduled for next week, pushed today (in this week) — doesn't
    // affect THIS week's defer, since fromValue (next week) is outside.
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1, scheduledDate: schedDate(new Date(2026, 3, 15)) }),
    ]
    const events: TodoEvent[] = [
      ev({ todoId: 2, type: 'scheduled', timestamp: localISO(2026, 3, 14, 10), fromValue: localISO(2026, 3, 22), toValue: localISO(2026, 3, 29) }),
    ]
    const out = selectDisciplineMetrics({ events, todos, now: NOW, weekStartsOn: 1, weeks: 1 })
    // Denom = 1 (todo 1 currently in week), numerator = 0 → 0%.
    expect(out[0]!.values[0]).toBe(0)
  })

  it('fuzzy fromValue resolves using the event timestamp (schedule-today + push counts)', () => {
    // User flow: schedule a task for fuzzy:today (this week), then push it
    // to next week. The push event has fromValue='fuzzy:today', anchored at
    // the push timestamp (also this week). Resolved → it lands in this week
    // → counts in numerator. Currently `scheduledDate` is next week, so the
    // todos pass alone wouldn't add it to plannedInBucket — the event branch
    // does. Expected: 100% defer for the week.
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1, scheduledDate: schedDate(new Date(2026, 3, 20)) }),
    ]
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 14, 11), fromValue: 'fuzzy:today', toValue: localISO(2026, 3, 20) }),
    ]
    const out = selectDisciplineMetrics({ events, todos, now: NOW, weekStartsOn: 1, weeks: 1 })
    expect(out[0]!.values[0]).toBe(100)
  })

  it('todo with fuzzy scheduledDate counts in defer denominator when it resolves into the bucket', () => {
    // Task currently scheduled fuzzy:today; today (NOW) is in the latest bucket.
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } }),
    ]
    const out = selectDisciplineMetrics({ events: [], todos, now: NOW, weekStartsOn: 1, weeks: 1 })
    // Denom=1, num=0 → 0%. Important: the denominator counts the task even
    // though no push happened. (Same task with a push would yield 100%.)
    expect(out[0]!.values[0]).toBe(0)
  })

  it('completion: scheduled fuzzy:today + completed today scores 100% on-time', () => {
    // The bug the user reported on the on-time card. First scheduled event
    // toValue='fuzzy:today' anchored at the event's timestamp (today)
    // resolves into this week's bucket; completed event before week-end.
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 14, 9), fromValue: null, toValue: 'fuzzy:today' }),
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 14, 17) }),
    ]
    const out = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 1, weeks: 1 })
    expect(out[1]!.values[0]).toBe(100)
  })

  it('unrecognized fuzzy token on a push event is skipped (defensive parse failure)', () => {
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1, scheduledDate: schedDate(new Date(2026, 3, 15)) }),
    ]
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 14, 10), fromValue: 'fuzzy:bogus', toValue: localISO(2026, 3, 22) }),
    ]
    const out = selectDisciplineMetrics({ events, todos, now: NOW, weekStartsOn: 1, weeks: 1 })
    expect(out[0]!.values[0]).toBe(0)
  })

  it('defer = 0 when no tasks are planned for the week (denom = 0)', () => {
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1, scheduledDate: schedDate(new Date(2026, 5, 1)) }), // June, well outside.
    ]
    const out = selectDisciplineMetrics({ events: [], todos, now: NOW, weekStartsOn: 1, weeks: 1 })
    expect(out[0]!.values[0]).toBe(0)
  })

  it('lag = avg days between first scheduled and completed for completions in that week', () => {
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 6, 10), toValue: localISO(2026, 3, 10) }),
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 13, 10) }),
    ]
    const out = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 1, weeks: 2 })
    const lag = out[2]!.values
    // Completion landed in the latest bucket (week of Mon 2026-04-13). 7 days from first scheduled.
    expect(lag[lag.length - 1]).toBeCloseTo(7, 5)
  })

  it('completion = % of cohort whose first scheduled.toValue lands in the week AND who completed by week end', () => {
    const events: TodoEvent[] = [
      // todo 1: first scheduled to 2026-04-14 (in-week). Completed before week end.
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 12, 8), toValue: localISO(2026, 3, 14) }),
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 15, 8) }),
      // todo 2: first scheduled to 2026-04-16 (in-week). Never completed.
      ev({ todoId: 2, type: 'scheduled', timestamp: localISO(2026, 3, 12, 9), toValue: localISO(2026, 3, 16) }),
      // todo 3: first scheduled to 2026-04-13 (in-week). Completed AFTER week end → counts as not completed.
      ev({ todoId: 3, type: 'scheduled', timestamp: localISO(2026, 3, 10, 9), toValue: localISO(2026, 3, 13) }),
      ev({ todoId: 3, type: 'completed', timestamp: localISO(2026, 3, 25, 8) }),
    ]
    const out = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 1, weeks: 1 })
    const completion = out[1]!.values
    // Cohort = 3, completed-in-window = 1 (todo 1). 1/3 ≈ 33.33%.
    expect(completion[0]!).toBeCloseTo((1 / 3) * 100, 5)
  })

  it('completion bucket with empty cohort emits 0 (UI treats as no signal)', () => {
    const out = selectDisciplineMetrics({ events: [], now: NOW, weekStartsOn: 1, weeks: 4 })
    expect(out[1]!.values.every((v) => v === 0)).toBe(true)
  })

  it('fuzzy scheduled.toValue does NOT contribute to the completion cohort', () => {
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 12, 8), toValue: 'fuzzy:this-week' }),
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 15, 8) }),
    ]
    const out = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 1, weeks: 1 })
    expect(out[1]!.values[0]).toBe(0)
  })

  it('only the earliest completed event per todo is counted for lag (re-complete is a no-op)', () => {
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 6, 10), toValue: localISO(2026, 3, 10) }),
      // First completion in bucket 0 (Mon 4/6 .. Mon 4/13):
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 9, 10) }),
      // Re-open + re-complete in bucket 1 (Mon 4/13 .. Mon 4/20) — earliest still wins.
      ev({ todoId: 1, type: 'reopened', timestamp: localISO(2026, 3, 14, 10) }),
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 15, 10) }),
    ]
    const out = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 1, weeks: 2 })
    // Lag attributes the completion to bucket 0 only (4/9 - 4/6 = 3 days). The
    // re-completion in bucket 1 must NOT add a second lag sample.
    expect(out[2]!.values[0]).toBeCloseTo(3, 5)
    expect(out[2]!.values[1]).toBe(0)
  })

  it('weekStartsOn parity — flipping from 1 to 0 shifts which bucket a completion lands in (lag)', () => {
    // Completion on Sunday 2026-04-12 local; with weekStartsOn=1 it sits in the
    // week of Monday 2026-04-06; with weekStartsOn=0 it opens a new week.
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 8, 10), toValue: localISO(2026, 3, 10) }),
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 12, 12) }),
    ]
    const monAligned = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 1, weeks: 2 })
    const sunAligned = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 0, weeks: 2 })
    // Lag (scheduled 4/8 10:00 → completed 4/12 12:00) ≈ 4.08 days, attributed to
    // whichever bucket the completion lands in.
    // Mon-week containing Sunday 4/12 = the week starting Mon 4/6 → bucket 0.
    expect(monAligned[2]!.values[0]).toBeCloseTo(4.08, 1)
    expect(monAligned[2]!.values[1]).toBe(0)
    // Sun-week containing Sunday 4/12 = the week starting Sun 4/12 → bucket 1.
    expect(sunAligned[2]!.values[0]).toBe(0)
    expect(sunAligned[2]!.values[1]).toBeCloseTo(4.08, 1)
  })
})
