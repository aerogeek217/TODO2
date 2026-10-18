import { describe, expect, it } from 'vitest'
import { computeFollowupGroups } from '../../../services/stats/followup-groups'
import { makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10)
const day = (n: number) => new Date(2026, 9, 10 + n)

describe('computeFollowupGroups', () => {
  const tasks = [-3, 0, 1, 2, 3, 6, 7, 13, 14].map((n, i) => makeTodo({ id: i + 1, nextFollowupAt: day(n) }))

  it('splits open tasks into Late / Today / the rest of the look-ahead window (today … today + N − 1)', () => {
    expect(computeFollowupGroups(tasks, { today })).toEqual({ late: [1], today: [2], upcoming: [3, 4, 5, 6] })
    expect(computeFollowupGroups(tasks, { today }, 3)).toEqual({ late: [1], today: [2], upcoming: [3, 4] })
    expect(computeFollowupGroups(tasks, { today }, 14)).toEqual({ late: [1], today: [2], upcoming: [3, 4, 5, 6, 7, 8] })
  })

  it('skips completed tasks and tasks without a follow-up; orders by follow-up then sortOrder', () => {
    const groups = computeFollowupGroups([
      makeTodo({ id: 1, nextFollowupAt: day(-1), isCompleted: true }),
      makeTodo({ id: 2 }),
      makeTodo({ id: 3, sortOrder: 9, nextFollowupAt: day(-1) }),
      makeTodo({ id: 4, sortOrder: 1, nextFollowupAt: day(-1) }),
      makeTodo({ id: 5, sortOrder: 0, nextFollowupAt: day(-2) }),
    ], { today })
    expect(groups).toEqual({ late: [5, 4, 3], today: [], upcoming: [] })
  })

  it('an empty set gives empty groups', () => {
    expect(computeFollowupGroups([], { today })).toEqual({ late: [], today: [], upcoming: [] })
  })
})
