import { describe, expect, it } from 'vitest'
import { computePeopleStats } from '../../../services/stats/people'
import { computeTagStats } from '../../../services/stats/tags'
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

describe('the top bar’s @ / # picks narrow the rows, as a list grouped by them', () => {
  const tasks = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 }), makeTodo({ id: 4 })]
  // 1: Amy and Bob · 2: Bob and Zed · 3: Zed alone · 4: nobody.
  const map = new Map([[1, [amy, bob]], [2, [bob, zed]], [3, [zed]]])
  const rows = (r: number[][]) => computePeopleStats(tasks, ctx(map), r).rows.map((row) => [row.person.name, row.ids])

  it('one pick: a task counts under the picked people alone; no Unassigned row', () => {
    expect(rows([[2]])).toEqual([['Amy', [1]]])
    expect(computePeopleStats(tasks, ctx(map), [[2]]).unassigned.ids).toEqual([])
  })

  it('several picks of one filter (an or): each task under the ones it has', () => {
    expect(rows([[2, 3]])).toEqual([['Bob', [1, 2]], ['Amy', [1]]])
  })

  it('the chips and the lens both pick: those both pick win, else any one', () => {
    // Chips Amy or Bob, lens Bob: task 1 shows under Bob only; Zed never shows.
    expect(rows([[2, 3], [3]])).toEqual([['Bob', [1, 2]]])
  })

  it('the Unassigned pick (0) keeps the Unassigned row while every pick has it', () => {
    expect(computePeopleStats(tasks, ctx(map), [[0, 2]]).unassigned.ids).toEqual([4])
    expect(computePeopleStats(tasks, ctx(map), [[0, 2], [2]]).unassigned.ids).toEqual([])
    expect(computePeopleStats(tasks, ctx(map), []).unassigned.ids).toEqual([4])
  })

  it('tags alike: the # picks narrow the Tags rows and their tagged ids', () => {
    const atlas = { id: 1, name: 'Atlas', color: '#111' }
    const beta = { id: 2, name: 'Beta', color: '#222' }
    const tagCtx = { ...ctx(new Map()), assignedTagsMap: new Map([[1, [atlas, beta]], [2, [beta]]]) }
    const out = computeTagStats(tasks, tagCtx, [[1]])
    expect(out.rows.map((r) => [r.tag.name, r.ids])).toEqual([['Atlas', [1]]])
    expect(out.taggedIds).toEqual([1])
    expect(out.untagged.ids).toEqual([])
    expect(computeTagStats(tasks, tagCtx).rows.map((r) => r.tag.name)).toEqual(['Beta', 'Atlas'])
  })
})
