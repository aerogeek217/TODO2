import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, Tag, TodoEvent, TodoEventType } from '../../../models'
import { historyExactFrom } from '../../../services/stats/filter-history'
import { statsFilter } from '../../../services/stats/stats-context'
import { computeTrend, trendBucketDays, trendCumulative, type TrendFilter } from '../../../services/stats/trend'
import type { FilterCriteria } from '../../../utils/filter-criteria'
import { emptyFilterCriteria, lookupsFor, makeTodo } from '../../helpers'

/**
 * Created vs completed with a filter (widget feedback 2C): each task counted
 * on a day only while the filter kept it as it was then — the Burndown's open
 * series and the Cumulative lines read the same days.
 */

const today = new Date(2026, 9, 10) // Sat 10 Oct
const ctx = { today, weekStartsOn: 0 as const }
/** Day `n` of the 14-day window (0 = Sun 27 Sep, 13 = today), at `hour`. */
const wd = (n: number, hour = 12) => new Date(2026, 8, 27 + n, hour)
const OLD = new Date(2026, 0, 1)
const OPS = 7

let seq = 0
function ev(todoId: number, type: TodoEventType, at: Date, fromValue: string | number | null = null, toValue: string | number | null = null): TodoEvent {
  return { id: ++seq, todoId, type, fromValue, toValue, timestamp: at.toISOString() }
}

function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: OLD, ...overrides })
}

const tag = (id: number): Tag => ({ id, name: `T${id}`, color: '#fff' })
const criteria = (patch: Partial<FilterCriteria>): FilterCriteria => ({ ...emptyFilterCriteria, ...patch })

/** The filter as the widget passes it: the screen stage, then its own, both admitting completed tasks. */
function trendFilter(own: FilterCriteria, tags: Record<number, number[]> = {}): TrendFilter {
  return {
    stages: [statsFilter(emptyFilterCriteria), { ...own, showCompleted: true }],
    lookups: lookupsFor({
      assignedTagsMap: new Map(Object.entries(tags).map(([k, ids]) => [Number(k), ids.map(tag)])),
    }),
    settings: { urgentRange: null, weekStartsOn: 0 },
  }
}

const tagged = criteria({ tags: new Set([OPS]) })

describe('computeTrend with a filter', () => {
  it('an empty filter counts as no filter does', () => {
    const tasks = [task({ id: 1 }), task({ id: 2, isCompleted: true, completedAt: wd(4) })]
    const events = [ev(1, 'created', wd(2)), ev(2, 'created', wd(-5)), ev(2, 'completed', wd(4))]
    const plain = computeTrend(tasks, events, ctx, '14d')
    const filtered = computeTrend(tasks, events, ctx, '14d', trendFilter(emptyFilterCriteria))
    expect(filtered.openSeries).toEqual(plain.openSeries)
    expect(filtered.daily).toEqual(plain.daily)
    expect([filtered.created, filtered.completed, filtered.net]).toEqual([plain.created, plain.completed, plain.net])
  })

  it('a task created and completed inside the range: one created and one completed; open only between', () => {
    const tasks = [task({ id: 1, createdAt: wd(3, 9), isCompleted: true, completedAt: wd(6) })]
    const events = [ev(1, 'created', wd(3, 9)), ev(1, 'completed', wd(6))]
    const t = computeTrend(tasks, events, ctx, '14d', trendFilter(emptyFilterCriteria))
    expect(t.daily[3]?.createdIds).toEqual([1])
    expect(t.daily[6]?.completedIds).toEqual([1])
    expect(t.openSeries.slice(2, 8)).toEqual([0, 1, 1, 1, 0, 0])
    expect(t.openAtStart).toBe(0)
    expect(t.net).toBe(0)
    const cumulative = trendCumulative(t)
    expect(cumulative.created.at(-1)).toBe(1)
    expect(cumulative.completed.at(-1)).toBe(1)
  })

  it('a reopened task: the undone completion isn’t counted; it is open again from the reopen', () => {
    const tasks = [task({ id: 1 })]
    const events = [ev(1, 'completed', wd(3)), ev(1, 'reopened', wd(5))]
    const t = computeTrend(tasks, events, ctx, '14d', trendFilter(emptyFilterCriteria))
    expect(t.completed).toBe(0)
    expect(t.openSeries.slice(2, 6)).toEqual([1, 0, 0, 1])
    expect(t.openAtStart).toBe(1)
    expect(t.openAtStartIds).toEqual([1])
  })

  it('a tag added mid-range brings the task in from that day (the Burndown rises then)', () => {
    // Tagged on day 6; open the whole range.
    const tasks = [task({ id: 1 }), task({ id: 2 })]
    const events = [ev(1, 'tag', wd(6), null, OPS)]
    const t = computeTrend(tasks, events, ctx, '14d', trendFilter(tagged, { 1: [OPS] }))
    expect(t.openSeries.slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 1, 1])
    expect(t.openSeries.at(-1)).toBe(1)
    expect(t.openAtStart).toBe(0)
    expect(t.net).toBe(1)
    expect(t.daily[6]?.openIds).toEqual([1])
  })

  it('a completion counts only while the filter kept the task that day', () => {
    // Task 1: tag removed on day 2, completed on day 4 — not counted. Task 2: tagged, completed day 5 — counted.
    const tasks = [task({ id: 1, isCompleted: true, completedAt: wd(4) }), task({ id: 2, isCompleted: true, completedAt: wd(5) })]
    const events = [ev(1, 'tag', wd(2), OPS, null), ev(1, 'completed', wd(4)), ev(2, 'completed', wd(5))]
    const t = computeTrend(tasks, events, ctx, '14d', trendFilter(tagged, { 2: [OPS] }))
    expect(t.completed).toBe(1)
    expect(t.daily[5]?.completedIds).toEqual([2])
    expect(t.openSeries.slice(0, 6)).toEqual([2, 2, 1, 1, 1, 0])
  })

  it('a task done before the range and never reopened is in no count', () => {
    const tasks = [task({ id: 1, isCompleted: true, completedAt: wd(-10) })]
    const t = computeTrend(tasks, [ev(1, 'completed', wd(-10))], ctx, '14d', trendFilter(emptyFilterCriteria))
    expect([t.created, t.completed, t.openAtStart, t.net]).toEqual([0, 0, 0, 0])
    expect(t.openSeries.every((n) => n === 0)).toBe(true)
  })

  it('weekly buckets sum their days; the daily points stay per day', () => {
    const tasks = [task({ id: 1 }), task({ id: 2 })]
    const t = computeTrend(tasks, [ev(1, 'created', new Date(2026, 8, 14, 10)), ev(2, 'created', new Date(2026, 9, 5))], ctx, '4w', trendFilter(emptyFilterCriteria))
    expect(t.buckets.map((b) => b.createdIds.length)).toEqual([1, 0, 0, 1])
    expect(t.daily).toHaveLength(28)
    expect(trendBucketDays(t.window)).toEqual([{ first: 0, last: 6 }, { first: 7, last: 13 }, { first: 14, last: 20 }, { first: 21, last: 27 }])
  })
})

describe('historyExactFrom', () => {
  const days = Array.from({ length: 14 }, (_, i) => wd(i, 0))

  it('a filter reading only logged-since-ever fields is exact every day', () => {
    expect(historyExactFrom(emptyFilterCriteria, days, null)).toEqual({ from: 0, approximate: [] })
  })

  it('a range reaching before the history log’s start: the days before it are approximate', () => {
    // The log began during day 5.
    expect(historyExactFrom(tagged, days, wd(5, 15))).toEqual({ from: 5, approximate: ['tags'] })
    expect(historyExactFrom(tagged, days, wd(-3))).toEqual({ from: 0, approximate: [] })
    expect(historyExactFrom(tagged, days, null)).toEqual({ from: 14, approximate: ['tags'] })
  })

  it('text is never exact', () => {
    expect(historyExactFrom(criteria({ searchText: 'call' }), days, wd(-3)).from).toBe(14)
  })
})
