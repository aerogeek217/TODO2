import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem } from '../../../models'
import { goalProgress, oldestDate, oldestOf, percentOf, shareOf, shareSeries, weekDaysGone } from '../../../services/stats/number-shapes'

/** Thu 15 Oct 2026, local midnight. */
const TODAY = new Date(2026, 9, 15)
const day = (offset: number) => new Date(2026, 9, 15 + offset, 9)

function task(id: number, patch: Partial<PersistedTodoItem> = {}): PersistedTodoItem {
  return {
    id, uid: `u${id}`, title: `Task ${id}`, isCompleted: false, sortOrder: id,
    createdAt: day(-30), modifiedAt: day(-1), ...patch,
  }
}

describe('Share of…', () => {
  it('keeps the tasks both filters keep, in the Number’s order, out of the second filter’s', () => {
    expect(shareOf([5, 2, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ ids: [5, 2, 9], of: 10, percent: 30 })
    // A task the second filter drops isn't part of the share.
    expect(shareOf([5, 2, 11], [2, 5, 6, 7])).toEqual({ ids: [5, 2], of: 4, percent: 50 })
  })

  it('an empty whole has no percent; percents round to whole ones', () => {
    expect(shareOf([1], [])).toEqual({ ids: [], of: 0, percent: null })
    expect(percentOf(1, 3)).toBe(33)
    expect(percentOf(2, 3)).toBe(67)
    expect(percentOf(20, 109)).toBe(18)
  })

  it('a series is each day’s percent, a day with nothing in the whole reading 0', () => {
    expect(shareSeries([1, 2, 0, 3], [4, 4, 0, 6])).toEqual([25, 50, 0, 50])
  })
})

describe('Oldest', () => {
  it('ages by the date picked; never followed up ages from its creation; no due date is not aged', () => {
    const t = task(1, { lastFollowupAt: day(-4), dueDate: day(2) })
    expect(oldestDate(t, 'lastFollowup')).toEqual(day(-4))
    expect(oldestDate(task(2), 'lastFollowup')).toEqual(day(-30))
    expect(oldestDate(t, 'created')).toEqual(day(-30))
    expect(oldestDate(t, 'modified')).toEqual(day(-1))
    expect(oldestDate(t, 'deadline')).toEqual(day(2))
    expect(oldestDate(task(2), 'deadline')).toBeNull()
  })

  it('the oldest first, its title and age, and the median age (by local day)', () => {
    const tasks = [
      task(1, { lastFollowupAt: day(-3) }),
      task(2, { lastFollowupAt: day(-19), title: 'Vendor quote, new region' }),
      task(3, { lastFollowupAt: day(-6) }),
      task(4, { lastFollowupAt: day(-8) }),
    ]
    const byId = new Map(tasks.map((t) => [t.id, t]))
    expect(oldestOf([1, 2, 3, 4], byId, 'lastFollowup', TODAY)).toEqual({
      ids: [2, 4, 3, 1],
      oldest: { id: 2, title: 'Vendor quote, new region', days: 19 },
      median: 7,
    })
    // An odd count: the middle one.
    expect(oldestOf([1, 2, 3], byId, 'lastFollowup', TODAY).median).toBe(6)
  })

  it('by due date: days late (negative while still ahead); undated tasks left out; ties keep the Number’s order', () => {
    const tasks = [task(1, { dueDate: day(3) }), task(2), task(3, { dueDate: day(3) })]
    const byId = new Map(tasks.map((t) => [t.id, t]))
    expect(oldestOf([3, 1, 2], byId, 'deadline', TODAY)).toEqual({ ids: [3, 1], oldest: { id: 3, title: 'Task 3', days: -3 }, median: -3 })
  })

  it('no tasks: no oldest, no median', () => {
    expect(oldestOf([], new Map(), 'created', TODAY)).toEqual({ ids: [], oldest: null, median: null })
  })
})

describe('Against a goal', () => {
  it('the days of the week gone by the end of today, from the week’s first day', () => {
    // Thursday: the fifth day of a Sunday week, the fourth of a Monday one.
    expect(weekDaysGone(TODAY, 0)).toBe(5)
    expect(weekDaysGone(TODAY, 1)).toBe(4)
    expect(weekDaysGone(new Date(2026, 9, 11), 0)).toBe(1)
    expect(weekDaysGone(new Date(2026, 9, 11), 1)).toBe(7)
  })

  it('at least, weekly: met, on pace at or past the pace tick, else behind (lit)', () => {
    const goal = { atLeast: 14, period: 'week' as const }
    // Thursday of a Sunday week: the pace is 14 × 5 / 7 = 10.
    expect(goalProgress(14, goal, TODAY, 0)).toMatchObject({ state: 'met', lit: false, fraction: 1, pace: 10 })
    expect(goalProgress(10, goal, TODAY, 0)).toMatchObject({ state: 'onPace', lit: false, paceFraction: 10 / 14 })
    expect(goalProgress(9, goal, TODAY, 0)).toMatchObject({ state: 'behind', lit: true, fraction: 9 / 14 })
    expect(goalProgress(20, goal, TODAY, 0).fraction).toBe(1)
  })

  it('at least, weekly: the week’s first day is compared with 0, so the week never opens behind (cr34, answer 15)', () => {
    const goal = { atLeast: 14, period: 'week' as const }
    // Sun 11 Oct, a week starting on Sunday: nothing counted yet, and not behind; the pace tick still marks the day's share.
    const sun = new Date(2026, 9, 11)
    expect(goalProgress(0, goal, sun, 0)).toMatchObject({ state: 'onPace', lit: false, pace: 2, paceFraction: 2 / 14, fraction: 0 })
    expect(goalProgress(1, goal, sun, 0)).toMatchObject({ state: 'onPace', lit: false })
    expect(goalProgress(14, goal, sun, 0)).toMatchObject({ state: 'met', lit: false })
    // The second day compares with its own pace again: 2 days' share by the end of Monday.
    const mon = new Date(2026, 9, 12)
    expect(goalProgress(0, goal, mon, 0)).toMatchObject({ state: 'behind', lit: true, pace: 4 })
    expect(goalProgress(3, goal, mon, 0)).toMatchObject({ state: 'behind', lit: true })
    expect(goalProgress(4, goal, mon, 0)).toMatchObject({ state: 'onPace', lit: false })
    // A week starting on Monday: Monday is its first day, that Sunday its last (the whole target is due).
    expect(goalProgress(0, goal, mon, 1)).toMatchObject({ state: 'onPace', lit: false, pace: 2 })
    expect(goalProgress(13, goal, sun, 1)).toMatchObject({ state: 'behind', lit: true, pace: 14 })
    // The days the clocks change (Sun 8 Mar and Sun 1 Nov 2026 in the US) are first days like any other.
    expect(goalProgress(0, goal, new Date(2026, 2, 8), 0)).toMatchObject({ state: 'onPace', lit: false })
    expect(goalProgress(0, goal, new Date(2026, 10, 1), 0)).toMatchObject({ state: 'onPace', lit: false })
    expect(goalProgress(0, goal, new Date(2026, 10, 2), 0)).toMatchObject({ state: 'behind', lit: true })
    // A target of 0 is met at once, on any day.
    expect(goalProgress(0, { atLeast: 0, period: 'week' }, sun, 0)).toMatchObject({ state: 'met', lit: false })
  })

  it('at most, weekly: the first day changes nothing — over the limit is over on any day', () => {
    const sun = new Date(2026, 9, 11)
    expect(goalProgress(8, { atMost: 7, period: 'week' }, sun, 0)).toMatchObject({ state: 'over', lit: true, pace: 1 })
    expect(goalProgress(0, { atMost: 7, period: 'week' }, sun, 0)).toMatchObject({ state: 'within', lit: false })
  })

  it('at least, no period: behind (lit) until met; no pace', () => {
    expect(goalProgress(3, { atLeast: 5 }, TODAY, 0)).toMatchObject({ state: 'behind', lit: true, pace: null, paceFraction: null })
    expect(goalProgress(5, { atLeast: 5 }, TODAY, 0)).toMatchObject({ state: 'met', lit: false })
  })

  it('at most: within, or over the limit (lit); a weekly one still marks its pace', () => {
    expect(goalProgress(3, { atMost: 3 }, TODAY, 0)).toMatchObject({ way: 'atMost', state: 'within', lit: false, fraction: 1 })
    expect(goalProgress(4, { atMost: 3 }, TODAY, 0)).toMatchObject({ state: 'over', lit: true })
    expect(goalProgress(0, { atMost: 0 }, TODAY, 0)).toMatchObject({ state: 'within', lit: false, fraction: 0 })
    expect(goalProgress(2, { atMost: 7, period: 'week' }, TODAY, 1)).toMatchObject({ state: 'within', pace: 4, paceFraction: 4 / 7 })
  })
})
