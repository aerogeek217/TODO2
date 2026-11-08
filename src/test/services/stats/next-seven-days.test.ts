import { describe, expect, it } from 'vitest'
import { computeNextSevenDays } from '../../../services/stats/next-seven-days'
import { makeTodo } from '../../helpers'
import { DST_ZONE, pinTimeZone } from '../../time-zone'

const today = new Date(2026, 9, 10)
const day = (n: number) => new Date(2026, 9, 10 + n)

/** Midnight of 2026's first day with a daylight-saving change in this zone, if it has one. */
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

})

describe('computeNextSevenDays in a daylight-saving zone', () => {
  pinTimeZone(DST_ZONE)

  it('columns are local midnights, also across a daylight-saving change', () => {
    const start = dstChangeDay()
    expect(start).not.toBeNull()
    if (!start) return
    const cols = computeNextSevenDays([
      makeTodo({ id: 1, dueDate: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 23, 30) }),
    ], { today: start })
    for (const c of cols.slice(1)) {
      expect(c.date?.getHours()).toBe(0)
      expect(c.date?.getMinutes()).toBe(0)
    }
    expect(cols[2]?.dueIds).toEqual([1])
  })

  it('the fall-back day (25 hours) is one column: 23:30 on it is that day, 00:30 the next is the next', () => {
    const today = new Date(2026, 9, 31) // Sat 31 Oct; Sun 1 Nov is 25 hours long
    const cols = computeNextSevenDays([
      makeTodo({ id: 1, dueDate: new Date(2026, 10, 1, 23, 30) }),
      makeTodo({ id: 2, nextFollowupAt: new Date(2026, 10, 2, 0, 30) }),
    ], { today })
    expect(cols.slice(1).map((c) => c.date?.getDate())).toEqual([31, 1, 2, 3, 4, 5, 6])
    expect(cols[2]?.dueIds).toEqual([1])
    expect(cols[3]?.followupIds).toEqual([2])
  })
})
