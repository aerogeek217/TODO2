import { describe, expect, it } from 'vitest'
import type { Status } from '../../../models'
import { cellKey, computePivot, sortPivotRows } from '../../../services/stats/pivot'
import type { StatsContext } from '../../../services/stats/stats-context'
import { makePerson, makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10)
const amy = makePerson({ id: 1, name: 'Amy' })
const bob = makePerson({ id: 2, name: 'Bob' })
const status = (id: number, name: string): Status & { id: number } => ({ id, name, color: '#888', sortOrder: id, icon: 'circle' })

function ctx(over: Partial<StatsContext> = {}): StatsContext {
  return {
    today, weekStartsOn: 1, urgentRange: 3, assignedTagsMap: new Map(),
    assignedPeopleMap: new Map([[1, [amy]], [2, [amy, bob]], [3, [bob]], [4, [bob]]]),
    statuses: [status(10, 'Doing'), status(11, 'Waiting')],
    ...over,
  }
}

const tasks = [
  makeTodo({ id: 1, statusId: 10 }),
  makeTodo({ id: 2, statusId: 11 }),
  makeTodo({ id: 3, statusId: 11 }),
  makeTodo({ id: 4 }),
  makeTodo({ id: 5, statusId: 10 }),
]

describe('computePivot', () => {
  it('rows × columns as each axis splits; a cell holds the tasks both hold; the totals are each axis’s row', () => {
    const out = computePivot(tasks, ctx(), { rows: 'people', cols: 'status' })
    expect(out.rows.map((r) => r.label)).toEqual(['Bob', 'Amy', 'Unassigned'])
    expect(out.cols.map((c) => c.label)).toEqual(['Doing', 'Waiting', 'No status'])
    const n = (row: string, col: string) => out.cells.get(cellKey(row, col))?.length ?? 0
    expect([n('person-1', 'status-10'), n('person-1', 'status-11'), n('person-1', 'none')]).toEqual([1, 1, 0])
    expect([n('person-2', 'status-10'), n('person-2', 'status-11'), n('person-2', 'none')]).toEqual([0, 2, 1])
    expect([n('none', 'status-10'), n('none', 'status-11')]).toEqual([1, 0])
    expect(out.max).toBe(2)
    // A task with two people counts in each row; the grand total counts it once.
    expect(out.rows.map((r) => r.ids.length)).toEqual([3, 2, 1])
    expect(out.ids).toHaveLength(5)
  })

  it('an empty cell has no key; no tasks, no rows', () => {
    const out = computePivot(tasks, ctx(), { rows: 'people', cols: 'status' })
    expect(out.cells.has(cellKey('person-2', 'status-10'))).toBe(false)
    expect(computePivot([], ctx(), { rows: 'people', cols: 'status' })).toMatchObject({ rows: [], cols: [], max: 0, ids: [] })
  })

  it('a people axis narrows by the @ picks; a task the picks leave out of an axis isn’t counted', () => {
    const out = computePivot(tasks, ctx(), { rows: 'people', cols: 'status', restrictions: { people: [[1]] } })
    expect(out.rows.map((r) => r.label)).toEqual(['Amy'])
    expect(out.ids.sort()).toEqual([1, 2])
  })
})

describe('computePivot — the people / tags order', () => {
  const day = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n)
  // Amy: three open tasks, none due; Bob: one, overdue; Cy: one, a follow-up due today; Dee: one due later.
  const cy = makePerson({ id: 3, name: 'Cy' })
  const dee = makePerson({ id: 4, name: 'Dee' })
  const people = new Map([[1, [amy]], [2, [amy]], [3, [amy]], [4, [bob]], [5, [cy]], [6, [dee]]])
  const work = [
    makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 }),
    makeTodo({ id: 4, dueDate: day(-2) }),
    makeTodo({ id: 5, nextFollowupAt: day(0) }),
    makeTodo({ id: 6, dueDate: day(20) }),
  ]

  it('the ones with tasks due or due a follow-up first (Settings’ ranges), then by open tasks', () => {
    const out = computePivot(work, ctx({ assignedPeopleMap: people }), { rows: 'people', cols: 'status' })
    expect(out.rows.map((r) => r.label)).toEqual(['Bob', 'Cy', 'Amy', 'Dee'])
  })

  it('reads the ranges it is given: due within 30 days counts Dee’s', () => {
    const out = computePivot(work, ctx({ assignedPeopleMap: people }), { rows: 'people', cols: 'status', ranges: { due: 30, followup: 0 } })
    expect(out.rows.map((r) => r.label).slice(0, 3)).toEqual(['Bob', 'Cy', 'Dee'])
  })
})

// Item 8: the rows sorted by a heading, as a Breakdown's.
describe('sortPivotRows', () => {
  const stats = computePivot(tasks, ctx(), { rows: 'people', cols: 'status' })
  const labels = (sort: Parameters<typeof sortPivotRows>[1]) => sortPivotRows(stats, sort).map((r) => r.label)

  it('no sort: the natural order, the none row last', () => {
    expect(labels(undefined)).toEqual(['Bob', 'Amy', 'Unassigned'])
  })

  it('by a column: its cells largest first, reversed fewest first; the none row stays last', () => {
    // Doing: Amy 1, Bob 0, Unassigned 1. Waiting: Bob 2, Amy 1.
    expect(labels({ by: 'status-10' })).toEqual(['Amy', 'Bob', 'Unassigned'])
    expect(labels({ by: 'status-10', reversed: true })).toEqual(['Bob', 'Amy', 'Unassigned'])
    expect(labels({ by: 'status-11' })).toEqual(['Bob', 'Amy', 'Unassigned'])
  })

  it('by Total largest first; by the name A–Z, reversed Z–A', () => {
    expect(labels({ by: 'total' })).toEqual(['Bob', 'Amy', 'Unassigned'])
    expect(labels({ by: 'total', reversed: true })).toEqual(['Amy', 'Bob', 'Unassigned'])
    expect(labels({ by: 'name' })).toEqual(['Amy', 'Bob', 'Unassigned'])
    expect(labels({ by: 'name', reversed: true })).toEqual(['Bob', 'Amy', 'Unassigned'])
  })

  it('ties keep the natural order; a column the table no longer shows reads as the natural order', () => {
    const tied = computePivot(tasks.filter((t) => t.id !== 3), ctx(), { rows: 'people', cols: 'status' })
    // Without task 3, Bob and Amy hold one Waiting task each: the natural order stays.
    expect(sortPivotRows(tied, { by: 'status-11' }).map((r) => r.label)).toEqual(tied.rows.map((r) => r.label))
    expect(labels({ by: 'status-99' })).toEqual(['Bob', 'Amy', 'Unassigned'])
    expect(labels({ by: 'person-1' })).toEqual(['Bob', 'Amy', 'Unassigned'])
  })
})
