import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, TodoEvent, TodoEventType } from '../../../models'
import { computeClosedThisWeek } from '../../../services/stats/closed-this-week'
import { computeMetricHistory, hasHistory, HISTORY_AGAINST, historyDelta } from '../../../services/stats/metric-history'
import { computeTiles } from '../../../services/stats/tiles'
import { computeTrend } from '../../../services/stats/trend'
import { historyEventsStart } from '../../../utils/trend-window'
import { makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10) // Sat 10 Oct
const ctx = { today, weekStartsOn: 0 as const }
/** Day `n` of the 14-day history (0 = Sun 27 Sep, 13 = today), at `hour`. */
const hd = (n: number, hour = 12) => new Date(2026, 8, 27 + n, hour)
const OLD = new Date(2026, 0, 1)

let seq = 0
function ev(todoId: number, type: TodoEventType, at: Date, fromValue: string | null = null, toValue: string | null = null): TodoEvent {
  return { id: ++seq, todoId, type, fromValue, toValue, timestamp: at.toISOString() }
}

/** A task that has been there since long before the history. */
function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: OLD, ...overrides })
}

const fullCtx = { ...ctx, urgentRange: null, assignedPeopleMap: new Map(), assignedTagsMap: new Map(), statuses: [] }

describe('computeMetricHistory', () => {
  it('14 days ending today; only Open, Overdue, Due today and Closed this week have a line', () => {
    const h = computeMetricHistory([], [], ctx)
    expect(h.days).toHaveLength(14)
    expect(h.days[0]).toEqual(new Date(2026, 8, 27))
    expect(h.days.at(-1)).toEqual(today)
    expect(h.series.open).toEqual(new Array(14).fill(0))
    expect(['open', 'overdue', 'dueToday', 'closedThisWeek'].every((m) => hasHistory(m as never))).toBe(true)
    for (const m of ['focus', 'urgent', 'followupDue', 'noFollowup', 'dueNext7'] as const) expect(hasHistory(m)).toBe(false)
  })

  it('no events: each task as it is now, every day; today’s values are the tiles’', () => {
    const tasks = [
      task({ id: 1 }),
      task({ id: 2, dueDate: new Date(2026, 9, 1) }), // due before the window's end
      task({ id: 3, dueDate: today }),
    ]
    const h = computeMetricHistory(tasks, [], ctx)
    expect(h.series.open).toEqual(new Array(14).fill(3))
    // Task 2 is late from Fri 2 Oct (day 5) on; due today only today for task 3, due on day 4 for task 2.
    expect(h.series.overdue).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(h.series.dueToday).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    const tiles = computeTiles(tasks, fullCtx)
    expect(h.series.open.at(-1)).toBe(tiles.open.ids.length)
    expect(h.series.overdue.at(-1)).toBe(tiles.overdue.ids.length)
    expect(h.series.dueToday.at(-1)).toBe(tiles.dueToday.ids.length)
  })

  it('a completion: open until its day, then closed this week while the week lasts', () => {
    // Completed Tue 6 Oct (day 9); the week started Sun 4 Oct (day 7).
    const done = task({ id: 1, isCompleted: true, completedAt: hd(9) })
    const h = computeMetricHistory([done], [ev(1, 'completed', hd(9))], ctx)
    expect(h.series.open).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0])
    expect(h.series.closedThisWeek).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
    expect(h.series.closedThisWeek.at(-1)).toBe(computeClosedThisWeek([done], ctx).ids.length)
  })

  it('a completion last week counts until its week ends', () => {
    // Completed Thu 1 Oct (day 4); that week ran Sun 27 Sep – Sat 3 Oct (days 0 – 6).
    const done = task({ id: 1, isCompleted: true, completedAt: hd(4) })
    const h = computeMetricHistory([done], [ev(1, 'completed', hd(4))], ctx)
    expect(h.series.closedThisWeek).toEqual([0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0])
  })

  it('a reopen: done between its completion and its reopening, open again after', () => {
    const t = task({ id: 1 })
    const h = computeMetricHistory([t], [ev(1, 'completed', hd(8)), ev(1, 'reopened', hd(11))], ctx)
    expect(h.series.open).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1])
    expect(h.series.closedThisWeek).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0])
  })

  it('a due date change: each day reads the date it had then', () => {
    // Due Mon 28 Sep until Sat 3 Oct (day 6), when it moved to today.
    const t = task({ id: 1, dueDate: today })
    const moved = ev(1, 'deadline', hd(6), new Date(2026, 8, 28).toISOString(), today.toISOString())
    const h = computeMetricHistory([t], [moved], ctx)
    expect(h.series.dueToday).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    // Late from Tue 29 Sep (day 2) until the move.
    expect(h.series.overdue).toEqual([0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('a due date set mid-window: no due date before it', () => {
    const t = task({ id: 1, dueDate: new Date(2026, 9, 2) })
    const set = ev(1, 'deadline', hd(8), null, new Date(2026, 9, 2).toISOString())
    const h = computeMetricHistory([t], [set], ctx)
    expect(h.series.overdue).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1])
    expect(h.series.dueToday).toEqual(new Array(14).fill(0))
  })

  it('a task created mid-window isn’t there before its creation — by its event, or by its createdAt in a gap', () => {
    const logged = makeTodo({ id: 1, createdAt: hd(10), modifiedAt: hd(10) })
    const unlogged = makeTodo({ id: 2, createdAt: hd(12), modifiedAt: hd(12) })
    const h = computeMetricHistory([logged, unlogged], [ev(1, 'created', hd(10))], ctx)
    expect(h.series.open).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2])
  })

  it('a completed task with no events was open until its completion day (a gap in the log)', () => {
    const t = task({ id: 1, isCompleted: true, completedAt: hd(11) })
    const h = computeMetricHistory([t], [], ctx)
    expect(h.series.open).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0])
    expect(h.series.closedThisWeek).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1])
  })

  it('ignores other tasks’ events and other types; matches the trend’s open series', () => {
    const tasks = [task({ id: 1 }), task({ id: 2, isCompleted: true, completedAt: hd(5) })]
    const events = [
      ev(1, 'created', hd(3)), ev(2, 'completed', hd(5)), ev(99, 'created', hd(1)), ev(1, 'status', hd(4)),
    ]
    const h = computeMetricHistory(tasks, events, ctx)
    const trend = computeTrend(tasks, events, ctx, '14d')
    expect(h.series.open).toEqual(trend.openSeries)
  })
})

describe('historyDelta / historyEventsStart', () => {
  it('today against yesterday', () => {
    expect(historyDelta([1, 2, 5])).toBe(3)
    expect(historyDelta([4, 2])).toBe(-2)
    expect(historyDelta([4])).toBeNull()
  })

  it('Closed this week against the same point of last week: a new week’s first day reads no drop', () => {
    expect(HISTORY_AGAINST.closedThisWeek).toBe('lastWeek')
    expect(HISTORY_AGAINST.open).toBe('yesterday')
    // Sun 4 Oct is the week's first day (index 7 of a history ending then).
    const sunday = { today: new Date(2026, 9, 4), weekStartsOn: 0 as const }
    const sd = (n: number, hour = 12) => new Date(2026, 8, 21 + n, hour) // day n of that history (0 = Mon 21 Sep)
    const tasks = [
      task({ id: 1, isCompleted: true, completedAt: sd(7) }), // Mon 28 Sep, last week
      task({ id: 2, isCompleted: true, completedAt: sd(9) }), // Wed 30 Sep, last week
      task({ id: 3, isCompleted: true, completedAt: sd(13, 9) }), // this morning
    ]
    const series = computeMetricHistory(tasks, [], sunday).series.closedThisWeek
    expect(series.slice(-2)).toEqual([2, 1])
    expect(historyDelta(series)).toBe(-1) // the rollover, against yesterday
    // Last Sunday's end: nothing closed yet that week (Sun 27 Sep).
    expect(series.at(-8)).toBe(0)
    expect(historyDelta(series, 'lastWeek')).toBe(1)
    expect(historyDelta([1, 2, 3, 4, 5, 6, 7], 'lastWeek')).toBeNull()
  })

  it('reads events from the first day’s week start', () => {
    expect(historyEventsStart(today, 0)).toEqual(new Date(2026, 8, 27)) // Sun 27 Sep, the first day
    expect(historyEventsStart(today, 1)).toEqual(new Date(2026, 8, 21)) // Mon 21 Sep
  })
})

describe('computeClosedThisWeek', () => {
  it('completed from the week start through today, newest first', () => {
    const tasks = [
      task({ id: 1, isCompleted: true, completedAt: new Date(2026, 9, 4, 9) }), // Sun, the week's first day
      task({ id: 2, isCompleted: true, completedAt: new Date(2026, 9, 3, 23) }), // last week
      task({ id: 3, isCompleted: true, completedAt: new Date(2026, 9, 9, 8) }),
      task({ id: 4 }),
      task({ id: 5, isCompleted: true, modifiedAt: new Date(2026, 9, 6) }), // no completedAt: modifiedAt
    ]
    const c = computeClosedThisWeek(tasks, ctx)
    expect(c.ids).toEqual([3, 5, 1])
    expect(c.weekStart).toEqual(new Date(2026, 9, 4))
    expect(computeClosedThisWeek(tasks, { today, weekStartsOn: 1 }).ids).toEqual([3, 5])
  })
})
