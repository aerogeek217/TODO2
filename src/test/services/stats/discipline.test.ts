import { describe, it, expect } from 'vitest'
import type { TodoEvent } from '../../../models'
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

  it('defer = avg scheduled-event count per todo completed in that week', () => {
    // Single completion in week of 2026-04-13 (latest bucket).
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 1, 10), fromValue: null, toValue: localISO(2026, 3, 5) }),
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 5, 10), fromValue: localISO(2026, 3, 5), toValue: localISO(2026, 3, 10) }),
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 10, 10), fromValue: localISO(2026, 3, 10), toValue: localISO(2026, 3, 12) }),
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 14, 11) }),
    ]
    const out = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 1, weeks: 4 })
    const defer = out[0]!.values
    // Last bucket (week of Mon 2026-04-13): one completion with 3 scheduled events → avg = 3.
    expect(defer[defer.length - 1]).toBe(3)
    // Earlier buckets have no completions → 0.
    for (let i = 0; i < defer.length - 1; i++) expect(defer[i]).toBe(0)
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

  it('only the earliest completed event per todo is counted (re-completion is a no-op)', () => {
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 6, 10), toValue: localISO(2026, 3, 10) }),
      // First completion in the previous week (Mon 4/6 .. Mon 4/13):
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 9, 10) }),
      // Re-open then re-complete in the current week — should not double-count.
      ev({ todoId: 1, type: 'reopened', timestamp: localISO(2026, 3, 14, 10) }),
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 15, 10) }),
    ]
    const out = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 1, weeks: 2 })
    // Defer: earliest completion lands in bucket 0 (week of Mon 4/6). Last bucket = 0.
    expect(out[0]!.values[1]).toBe(0)
    expect(out[0]!.values[0]).toBe(1) // todo 1 has 1 scheduled event.
  })

  it('weekStartsOn parity — flipping from 1 to 0 shifts which bucket a completion lands in', () => {
    // Completion on Sunday 2026-04-12 local; with weekStartsOn=1 it sits in the
    // week of Monday 2026-04-06; with weekStartsOn=0 it opens a new week.
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: localISO(2026, 3, 8, 10), toValue: localISO(2026, 3, 10) }),
      ev({ todoId: 1, type: 'completed', timestamp: localISO(2026, 3, 12, 12) }),
    ]
    const monAligned = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 1, weeks: 2 })
    const sunAligned = selectDisciplineMetrics({ events, now: NOW, weekStartsOn: 0, weeks: 2 })
    // Mon-week containing Sunday 4/12 = the week starting Mon 4/6 → bucket 0.
    expect(monAligned[0]!.values[0]).toBe(1)
    expect(monAligned[0]!.values[1]).toBe(0)
    // Sun-week containing Sunday 4/12 = the week starting Sun 4/12 → bucket 1.
    expect(sunAligned[0]!.values[0]).toBe(0)
    expect(sunAligned[0]!.values[1]).toBe(1)
  })
})
