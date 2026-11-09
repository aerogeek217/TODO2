import { describe, expect, it } from 'vitest'
import type { Tag } from '../../../models'
import { computeEisenhowerSummary, eisenhowerSourceTasks } from '../../../services/stats/eisenhower-summary'
import type { FilterCriteria } from '../../../utils/filter-criteria'
import { emptyPredicate } from '../../../models/filter-predicate'
import type { StatsContext } from '../../../services/stats/stats-context'
import { emptyFilterCriteria, makeTodo, statsPaneContext, lookupsFor } from '../../helpers'
import { defaultPaneFilter, resolvePanes } from '../../../utils/eisenhower-panes'

const today = new Date(2026, 9, 10)
const day = (n: number, hour = 9) => new Date(2026, 9, 10 + n, hour)

function ctx(assignedTagsMap: Map<number, Tag[]> = new Map()): StatsContext {
  return { today, weekStartsOn: 1, urgentRange: 3, assignedPeopleMap: new Map(), assignedTagsMap, statuses: [] }
}

describe('computeEisenhowerSummary', () => {
  it('open tasks by effective Urgent × Important, in the Eisenhower widget’s order', () => {
    const tasks = [
      makeTodo({ id: 1, urgent: true, important: true }),
      makeTodo({ id: 2, important: true, dueDate: day(2, 0) }), // urgent by its due date (range 3)
      makeTodo({ id: 3, important: true }),
      makeTodo({ id: 4, urgent: true }),
      makeTodo({ id: 5, dueDate: day(-1, 0) }), // overdue: urgent by date
      makeTodo({ id: 6 }),
      makeTodo({ id: 7, dueDate: day(10, 0) }),
      makeTodo({ id: 8, urgent: true, important: true, isCompleted: true }), // completed: nowhere
    ]
    const out = computeEisenhowerSummary(tasks, resolvePanes({}), statsPaneContext(ctx()))
    expect(out.do).toEqual({ ids: [2, 1], byDate: 1 })
    expect(out.schedule).toEqual({ ids: [3], byDate: 0 })
    expect(out.delegate).toEqual({ ids: [5, 4], byDate: 1 })
    expect(out.drop).toEqual({ ids: [7, 6], byDate: 0 })
  })

  it('with the urgent range off only the flag makes a task urgent', () => {
    const out = computeEisenhowerSummary([makeTodo({ id: 1, important: true, dueDate: day(0, 0) })], resolvePanes({}), statsPaneContext({ ...ctx(), urgentRange: null }))
    expect(out.schedule.ids).toEqual([1])
    expect(out.do.ids).toEqual([])
  })
})

describe('computeEisenhowerSummary with custom panes', () => {
  it('counts each open task in the first pane it matches; a task in no pane is not counted', () => {
    const delegated = { id: 5, name: 'Delegated', color: '#999', sortOrder: 0 }
    const panes = resolvePanes({
      delegate: { name: 'Hand off', filter: { ...defaultPaneFilter('delegate'), statusIds: [5], negate: { statusIds: true } } },
    })
    const tasks = [
      makeTodo({ id: 1, urgent: true, statusId: 5 }), // urgent, not important, Delegated: in no pane
      makeTodo({ id: 2, urgent: true }),
      makeTodo({ id: 3, important: true }),
      makeTodo({ id: 4 }),
    ]
    const out = computeEisenhowerSummary(tasks, panes, statsPaneContext({ ...ctx(), statuses: [delegated] }))
    expect([out.do.ids, out.schedule.ids, out.delegate.ids, out.drop.ids]).toEqual([[], [3], [2], [4]])
  })
})

describe('eisenhowerSourceTasks', () => {
  const tasks = [
    makeTodo({ id: 1, urgent: true }),
    makeTodo({ id: 2, urgent: true, statusId: 7 }),
    makeTodo({ id: 3, important: true, statusId: 7 }),
  ]
  const opts = (screen: FilterCriteria) => ({
    screen,
    lookups: lookupsFor(),
    today,
    settings: { urgentRange: 3, weekStartsOn: 1 as const },
  })
  const list = {
    id: 9, name: 'Urgent', sortOrder: 0, sort: 'manual' as const, grouping: 'none' as const,
    membership: { kind: 'custom' as const, predicate: { ...emptyPredicate(), markers: [{ values: ['urgent' as const] }] } },
  }

  it('all tasks: the screen-filtered tasks shown, every task in the total', () => {
    const out = eisenhowerSourceTasks(tasks, [tasks[0]!], undefined, opts(emptyFilterCriteria))
    expect(out.shown.map((t) => t.id)).toEqual([1])
    expect(out.total.map((t) => t.id)).toEqual([1, 2, 3])
  })

  it('a list: its members in the total; shown passes the screen filter too', () => {
    const out = eisenhowerSourceTasks(tasks, tasks, list, opts({ ...emptyFilterCriteria, statusIds: new Set([7]) }))
    expect(out.total.map((t) => t.id)).toEqual([1, 2])
    expect(out.shown.map((t) => t.id)).toEqual([2])
  })
})
