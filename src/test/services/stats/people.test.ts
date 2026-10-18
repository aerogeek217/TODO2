import { describe, expect, it } from 'vitest'
import { computePeopleStats } from '../../../services/stats/people'
import type { StatsContext } from '../../../services/stats/stats-context'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { makePerson, makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10)
const zed = makePerson({ id: 1, name: 'Zed' })
const amy = makePerson({ id: 2, name: 'Amy' })
const bob = makePerson({ id: 3, name: 'Bob' })

function ctx(map: Map<number, ReturnType<typeof makePerson>[]>): StatsContext {
  return { today, weekStartsOn: 1, urgentRange: 3, hotRule: DEFAULT_HOT_RULE, assignedPeopleMap: map, assignedTagsMap: new Map(), statuses: [] }
}

describe('computePeopleStats', () => {
  it('counts a task for each of its people; sorts by open count, ties by name; Unassigned apart', () => {
    const tasks = [
      makeTodo({ id: 1, focus: true }),
      makeTodo({ id: 2, nextFollowupAt: new Date(2026, 9, 9) }),
      makeTodo({ id: 3 }),
      makeTodo({ id: 4, nextFollowupAt: new Date(2026, 9, 11) }),
      makeTodo({ id: 5 }),
    ]
    const map = new Map([
      [1, [zed, amy]],
      [2, [zed]],
      [3, [bob, bob]], // a duplicate row counts once
      [4, [amy]],
    ])
    const out = computePeopleStats(tasks, ctx(map))
    expect(out.rows.map((r) => [r.person.name, r.ids, r.hotIds, r.followupDueIds])).toEqual([
      ['Amy', [1, 4], [1], []],
      ['Zed', [1, 2], [1], [2]],
      ['Bob', [3], [], []],
    ])
    expect(out.unassigned).toEqual({ ids: [5], hotIds: [], followupDueIds: [] })
  })

  it('people with only completed tasks get no row; an empty set gives no rows', () => {
    const out = computePeopleStats([makeTodo({ id: 1, isCompleted: true })], ctx(new Map([[1, [amy]]])))
    expect(out.rows).toEqual([])
    expect(computePeopleStats([], ctx(new Map())).unassigned).toEqual({ ids: [], hotIds: [], followupDueIds: [] })
  })
})
