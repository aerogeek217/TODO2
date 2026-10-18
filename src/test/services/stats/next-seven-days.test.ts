import { describe, expect, it } from 'vitest'
import { computeNextSevenDays } from '../../../services/stats/next-seven-days'
import { makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10)
const day = (n: number) => new Date(2026, 9, 10 + n)

/** Midnight of a day with a daylight-saving change in this zone, if it has one. */
function dstChangeDay(): Date | null {
  for (let i = 0; i < 366; i++) {
    const d = new Date(2026, 0, 1 + i)
    const next = new Date(2026, 0, 2 + i)
    if (d.getTimezoneOffset() !== next.getTimezoneOffset()) return d
  }
  return null
}

describe('computeNextSevenDays', () => {
  it('Late, then today … today + 6; a task can sit in two columns', () => {
    const cols = computeNextSevenDays([
      makeTodo({ id: 1, dueDate: day(-5), nextFollowupAt: day(2) }),
      makeTodo({ id: 2, dueDate: day(6) }),
      makeTodo({ id: 3, dueDate: day(7), nextFollowupAt: day(-1) }),
      makeTodo({ id: 4, dueDate: day(0), nextFollowupAt: day(0) }),
      makeTodo({ id: 5, dueDate: day(0), isCompleted: true }),
    ], { today })
    expect(cols).toHaveLength(8)
    expect(cols[0]).toEqual({ date: null, dueIds: [1], followupIds: [3] })
    expect(cols[1]).toEqual({ date: day(0), dueIds: [4], followupIds: [4] })
    expect(cols[3]).toEqual({ date: day(2), dueIds: [], followupIds: [1] })
    expect(cols[7]).toEqual({ date: day(6), dueIds: [2], followupIds: [] })
  })

  it('an empty set gives eight empty columns', () => {
    const cols = computeNextSevenDays([], { today })
    expect(cols.map((c) => c.dueIds.length + c.followupIds.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('columns are local midnights, also across a daylight-saving change', () => {
    const start = dstChangeDay()
    if (!start) return // no DST in this time zone
    const cols = computeNextSevenDays([
      makeTodo({ id: 1, dueDate: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 23, 30) }),
    ], { today: start })
    for (const c of cols.slice(1)) {
      expect(c.date?.getHours()).toBe(0)
      expect(c.date?.getMinutes()).toBe(0)
    }
    expect(cols[2]?.dueIds).toEqual([1])
  })
})
