import { describe, expect, it } from 'vitest'
import type { TodoEvent, TodoEventType } from '../../../models'
import { computeTrend, trendWindow } from '../../../services/stats/trend'
import { makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10) // Sat
const ctx = { today, weekStartsOn: 0 as const }
/** Day `n` of the 14-day window (0 = Sun 27 Sep), at `hour`. */
const wd = (n: number, hour = 12, minute = 0) => new Date(2026, 8, 27 + n, hour, minute)

let seq = 0
function ev(todoId: number, type: TodoEventType, at: Date): TodoEvent {
  return { id: ++seq, todoId, type, fromValue: null, toValue: null, timestamp: at.toISOString() }
}

describe('trendWindow', () => {
  it('14 days: today and the 13 before, one bar per day', () => {
    const w = trendWindow('14d', today, 0)
    expect(w.granularity).toBe('day')
    expect(w.start).toEqual(new Date(2026, 8, 27))
    expect(w.days).toHaveLength(14)
    expect(w.bucketStarts).toHaveLength(14)
    expect(w.days.at(-1)).toEqual(today)
  })

  it('4 / 12 weeks: this week so far and the weeks before, from the configured week start', () => {
    const sun = trendWindow('4w', today, 0)
    expect(sun.granularity).toBe('week')
    expect(sun.start).toEqual(new Date(2026, 8, 13)) // Sun 13 Sep
    expect(sun.bucketStarts.map((d) => d.getDate())).toEqual([13, 20, 27, 4])
    expect(sun.days).toHaveLength(28)

    const mon = trendWindow('4w', today, 1)
    expect(mon.start).toEqual(new Date(2026, 8, 14)) // Mon 14 Sep
    expect(mon.days).toHaveLength(27) // this week runs Mon 5 … Sat 10

    const twelve = trendWindow('12w', today, 1)
    expect(twelve.bucketStarts).toHaveLength(12)
    expect(twelve.bucketStarts[11]).toEqual(new Date(2026, 9, 5))
  })
})

describe('computeTrend', () => {
  it('no tasks / no events: zero bars, a flat open series', () => {
    const empty = computeTrend([], [], ctx, '14d')
    expect([empty.created, empty.completed, empty.net, empty.openAtStart]).toEqual([0, 0, 0, 0])
    expect(empty.openSeries).toEqual(new Array(14).fill(0))

    const quiet = computeTrend([makeTodo({ id: 1 }), makeTodo({ id: 2, isCompleted: true })], [], ctx, '14d')
    expect(quiet.openSeries).toEqual(new Array(14).fill(1))
    expect(quiet.net).toBe(0)
  })

  it('created and completed per day; the open series counts back from now', () => {
    const tasks = [makeTodo({ id: 1 }), makeTodo({ id: 2, isCompleted: true })]
    const events = [ev(1, 'created', wd(2)), ev(2, 'created', wd(-5)), ev(2, 'completed', wd(4))]
    const t = computeTrend(tasks, events, ctx, '14d')
    expect(t.buckets[2]?.createdIds).toEqual([1])
    expect(t.buckets[4]?.completedIds).toEqual([2])
    expect([t.created, t.completed]).toEqual([1, 1])
    expect(t.openAtStart).toBe(1)
    expect(t.openSeries.slice(0, 6)).toEqual([1, 1, 2, 2, 1, 1])
    expect(t.net).toBe(0)
  })

  it('a reopened completion does not count; the series still dips while it was done', () => {
    const tasks = [makeTodo({ id: 1 })]
    const t = computeTrend(tasks, [ev(1, 'completed', wd(3)), ev(1, 'reopened', wd(5))], ctx, '14d')
    expect(t.completed).toBe(0)
    expect(t.openSeries.slice(2, 6)).toEqual([1, 0, 0, 1])
  })

  it('completed, reopened, completed again: one completion, on the last day', () => {
    const tasks = [makeTodo({ id: 1, isCompleted: true })]
    const t = computeTrend(tasks, [
      ev(1, 'completed', wd(3)), ev(1, 'reopened', wd(5)), ev(1, 'completed', wd(8)),
    ], ctx, '14d')
    expect(t.buckets.flatMap((b, i) => b.completedIds.map(() => i))).toEqual([8])
    expect(t.openSeries[8]).toBe(0)
    expect(t.openSeries[5]).toBe(1)
  })

  it('a reopen of a completion from before the window adds no bar but counts in the series and net', () => {
    const t = computeTrend([makeTodo({ id: 1 })], [ev(1, 'reopened', wd(6))], ctx, '14d')
    expect(t.completed).toBe(0)
    expect(t.openAtStart).toBe(0)
    expect(t.openSeries[5]).toBe(0)
    expect(t.openSeries[6]).toBe(1)
    expect(t.net).toBe(1)
  })

  it('created and completed the same day: both bars, no change in the day’s closing count', () => {
    const t = computeTrend([makeTodo({ id: 1, isCompleted: true })], [
      ev(1, 'created', wd(4, 9)), ev(1, 'completed', wd(4, 16)),
    ], ctx, '14d')
    expect(t.buckets[4]).toMatchObject({ createdIds: [1], completedIds: [1] })
    expect(t.openSeries.every((n) => n === 0)).toBe(true)
  })

  it('a task inserted already completed is never open', () => {
    const t = computeTrend([makeTodo({ id: 1, isCompleted: true })], [ev(1, 'created', wd(4))], ctx, '14d')
    expect(t.created).toBe(1)
    expect(t.openSeries.every((n) => n === 0)).toBe(true)
  })

  it('purged history: events of tasks not in the set, and other event types, are ignored', () => {
    const t = computeTrend([makeTodo({ id: 1 })], [
      ev(99, 'created', wd(3)), ev(99, 'completed', wd(4)),
      { ...ev(1, 'status', wd(5)), fromValue: 1, toValue: 2 },
      { ...ev(1, 'deadline', wd(6)), toValue: wd(9).toISOString() },
    ], ctx, '14d')
    expect([t.created, t.completed]).toEqual([0, 0])
    expect(t.openSeries).toEqual(new Array(14).fill(1))
  })

  it('day boundaries are local: 23:59 counts for that day, 00:00 for the next', () => {
    const tasks = [makeTodo({ id: 1 }), makeTodo({ id: 2 })]
    const t = computeTrend(tasks, [ev(1, 'created', wd(3, 23, 59)), ev(2, 'created', wd(4, 0, 0))], ctx, '14d')
    expect(t.buckets[3]?.createdIds).toEqual([1])
    expect(t.buckets[4]?.createdIds).toEqual([2])
    expect(t.openSeries.slice(2, 5)).toEqual([0, 1, 2])
  })

  it('weekly bars sum each week; the series stays per day', () => {
    const tasks = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3, isCompleted: true })]
    const t = computeTrend(tasks, [
      ev(1, 'created', new Date(2026, 8, 14, 10)), // week of Sun 13 Sep
      ev(2, 'created', new Date(2026, 8, 19, 23, 30)), // Sat 19, same week
      ev(3, 'completed', new Date(2026, 9, 4, 0, 30)), // Sun 4 Oct = this week
    ], ctx, '4w')
    expect(t.buckets.map((b) => [b.createdIds.length, b.completedIds.length])).toEqual([[2, 0], [0, 0], [0, 0], [0, 1]])
    expect(t.openSeries).toHaveLength(28)
    expect(t.openSeries[0]).toBe(1) // Sun 13: task 3 open, tasks 1 / 2 not yet created
    expect(t.openSeries[1]).toBe(2)
    expect(t.openSeries[6]).toBe(3)
    expect(t.openSeries.at(-1)).toBe(2)
  })

  it('works across a daylight-saving change (per-day buckets by local calendar day)', () => {
    let change: Date | null = null
    for (let i = 0; i < 366 && !change; i++) {
      const d = new Date(2026, 0, 1 + i)
      // The change happens during day `d` (its midnight and the next differ).
      if (d.getTimezoneOffset() !== new Date(2026, 0, 2 + i).getTimezoneOffset()) change = d
    }
    if (!change) return // no DST in this time zone
    const end = new Date(change.getFullYear(), change.getMonth(), change.getDate() + 3)
    const at = (offset: number, hour: number, minute = 0) =>
      new Date(change.getFullYear(), change.getMonth(), change.getDate() + offset, hour, minute)
    const tasks = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const t = computeTrend(tasks, [
      ev(1, 'created', at(-1, 23, 30)),
      ev(2, 'created', at(0, 0, 30)),
      ev(3, 'created', at(0, 23, 30)),
    ], { today: end, weekStartsOn: 0 }, '14d')
    expect(t.window.days.every((d) => d.getHours() === 0)).toBe(true)
    // `change` is window day 10 (end = day 13).
    expect(t.buckets[9]?.createdIds).toEqual([1])
    expect(t.buckets[10]?.createdIds).toEqual([2, 3])
    expect(t.openSeries.slice(8, 12)).toEqual([0, 1, 3, 3])
  })
})
