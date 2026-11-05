import { describe, expect, it } from 'vitest'
import { computePeopleStats } from '../../../services/stats/people'
import type { StatsContext } from '../../../services/stats/stats-context'
import { makePerson, makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10)
const zed = makePerson({ id: 1, name: 'Zed' })
const amy = makePerson({ id: 2, name: 'Amy' })
const bob = makePerson({ id: 3, name: 'Bob' })

function ctx(map: Map<number, ReturnType<typeof makePerson>[]>): StatsContext {
  return { today, weekStartsOn: 1, urgentRange: 3, assignedPeopleMap: map, assignedTagsMap: new Map(), statuses: [] }
}

const NONE = { focus: 0, urgent: 0, important: 0 }
const PRIORITY_OF_1 = { ...NONE, focus: 1 }

describe('computePeopleStats', () => {
  it('counts each priority of a row\'s open tasks: a task with two counts in both; Urgent by due date counts', () => {
    const tasks = [
      makeTodo({ id: 1, focus: true, urgent: true }),
      makeTodo({ id: 2, important: true, dueDate: new Date(2026, 9, 11) }),
      makeTodo({ id: 3, important: true }),
      makeTodo({ id: 4 }),
      makeTodo({ id: 5, focus: true, isCompleted: true }),
    ]
    const out = computePeopleStats(tasks, ctx(new Map(tasks.map((t) => [t.id, [amy]]))))
    expect(out.rows[0]?.priority).toEqual({ focus: 1, urgent: 2, important: 2 })
  })

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
    expect(out.rows.map((r) => [r.person.name, r.ids, r.priority, r.followupDueIds])).toEqual([
      ['Amy', [1, 4], PRIORITY_OF_1, []],
      ['Zed', [1, 2], PRIORITY_OF_1, [2]],
      ['Bob', [3], NONE, []],
    ])
    expect(out.unassigned).toEqual({ ids: [5], priority: NONE, followupDueIds: [] })
  })

  it('people with only completed tasks get no row; an empty set gives no rows', () => {
    const out = computePeopleStats([makeTodo({ id: 1, isCompleted: true })], ctx(new Map([[1, [amy]]])))
    expect(out.rows).toEqual([])
    expect(computePeopleStats([], ctx(new Map())).unassigned).toEqual({ ids: [], priority: { focus: 0, urgent: 0, important: 0 }, followupDueIds: [] })
  })
})
