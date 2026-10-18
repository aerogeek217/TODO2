import { describe, expect, it } from 'vitest'
import { computeTiles } from '../../../services/stats/tiles'
import type { StatsContext } from '../../../services/stats/stats-context'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10)
const day = (n: number) => new Date(2026, 9, 10 + n)
const ctx: StatsContext = {
  today,
  weekStartsOn: 1,
  urgentRange: 3,
  hotRule: DEFAULT_HOT_RULE,
  assignedPeopleMap: new Map(),
  assignedTagsMap: new Map(),
  statuses: [],
}

describe('computeTiles', () => {
  it('an empty set gives empty tiles (and a line entry per Hot rule line)', () => {
    const tiles = computeTiles([], ctx)
    for (const tile of Object.values(tiles)) expect(tile.ids).toEqual([])
    expect(tiles.hot.lines.map((l) => l.ids)).toEqual([[], []])
    expect(tiles.overdue).toMatchObject({ oldest: null, oldestDaysLate: 0 })
    expect(tiles.urgent).toMatchObject({ flagged: 0, byDate: 0 })
    expect(tiles.followupDue).toMatchObject({ late: 0, today: 0, upcoming: 0 })
  })

  it('completed tasks count nowhere, whatever their markers and dates', () => {
    const done = makeTodo({
      id: 1, isCompleted: true, urgent: true, important: true, focus: true,
      dueDate: day(-2), nextFollowupAt: day(-1),
    })
    const tiles = computeTiles([done], ctx)
    for (const tile of Object.values(tiles)) expect(tile.ids).toEqual([])
  })

  it('urgent range Off: only flags make a task urgent (and hot through U+I)', () => {
    const byDate = makeTodo({ id: 1, important: true, dueDate: day(-1) })
    const flagged = makeTodo({ id: 2, urgent: true, important: true })
    const off = computeTiles([byDate, flagged], { ...ctx, urgentRange: null })
    expect(off.urgent).toEqual({ ids: [2], flagged: 1, byDate: 0 })
    expect(off.hot.ids).toEqual([2])
    // Still overdue.
    expect(off.overdue.ids).toEqual([1])

    const on = computeTiles([byDate, flagged], ctx)
    expect(on.urgent).toEqual({ ids: [1, 2], flagged: 1, byDate: 1 })
    expect(on.hot.ids).toEqual([1, 2])
  })

  it('urgent range edges: Today = due today or earlier; 3 days includes today + 3', () => {
    const tasks = [0, 1, 3, 4].map((n, i) => makeTodo({ id: i + 1, dueDate: day(n) }))
    expect(computeTiles(tasks, { ...ctx, urgentRange: 0 }).urgent.ids).toEqual([1])
    expect(computeTiles(tasks, ctx).urgent.ids).toEqual([1, 2, 3])
  })

  it('a hot task counts under the first rule line it matches', () => {
    const both = makeTodo({ id: 1, urgent: true, important: true, focus: true })
    const focusOnly = makeTodo({ id: 2, focus: true })
    const importantOnly = makeTodo({ id: 3, important: true })
    const tiles = computeTiles([both, focusOnly, importantOnly], {
      ...ctx,
      hotRule: [{ focus: true }, { urgent: true, important: true }, { important: true }],
    })
    expect(tiles.hot.ids).toEqual([1, 2, 3])
    expect(tiles.hot.lines.map((l) => l.ids)).toEqual([[1, 2], [], [3]])
  })

  it('ids come in dialog order: by date, undated last, ties by sortOrder', () => {
    const tasks = [
      makeTodo({ id: 1, sortOrder: 5, focus: true }),
      makeTodo({ id: 2, sortOrder: 9, focus: true, dueDate: day(2), nextFollowupAt: day(-1) }),
      makeTodo({ id: 3, sortOrder: 1, focus: true, dueDate: day(2), nextFollowupAt: day(-3) }),
      makeTodo({ id: 4, sortOrder: 2, focus: true, dueDate: day(-4), nextFollowupAt: day(0) }),
    ]
    const tiles = computeTiles(tasks, ctx)
    expect(tiles.focus.ids).toEqual([4, 3, 2, 1])
    expect(tiles.followupDue.ids).toEqual([3, 2, 4])
    expect(tiles.overdue).toMatchObject({ ids: [4], oldest: day(-4), oldestDaysLate: 4 })
  })

  it('the next 7 days are today … today + 6', () => {
    const tasks = [-1, 0, 6, 7].map((n, i) => makeTodo({ id: i + 1, dueDate: day(n), nextFollowupAt: day(n) }))
    const tiles = computeTiles(tasks, ctx)
    expect(tiles.dueNext7.ids).toEqual([2, 3])
    expect(tiles.dueToday).toEqual({ ids: [2], upcoming: 1 })
    expect(tiles.followupDue).toMatchObject({ ids: [1, 2], late: 1, today: 1, upcoming: 1 })
    expect(tiles.noFollowup.ids).toEqual([])
  })

  it('days are calendar days: a due time late in the day still counts for that day', () => {
    const late = makeTodo({ id: 1, dueDate: new Date(2026, 9, 9, 23, 59) })
    const early = makeTodo({ id: 2, dueDate: new Date(2026, 9, 10, 0, 1) })
    const tiles = computeTiles([late, early], ctx)
    expect(tiles.overdue.ids).toEqual([1])
    expect(tiles.dueToday.ids).toEqual([2])
  })
})
