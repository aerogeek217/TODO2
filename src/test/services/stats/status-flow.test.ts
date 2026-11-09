import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, Status, TodoEvent, TodoEventType } from '../../../models'
import { computeStatusFlow, NO_STATUS_BAND } from '../../../services/stats/status-flow'
import type { FilterCriteria } from '../../../utils/filter-criteria'
import { statusFlowDays } from '../../../utils/trend-window'
import { emptyFilterCriteria, lookupsFor, makeTodo } from '../../helpers'

/** A Status flow (D26 P8): the open tasks by status at each week's end, replayed from the status log. */

const today = new Date(2026, 9, 10) // Sat 10 Oct
const OLD = new Date(2026, 0, 1)
const NO_FILTER: FilterCriteria = { ...emptyFilterCriteria, markers: null }
const status = (id: number, name: string): Status & { id: number } => ({ id, name, color: `#${id}${id}${id}`, sortOrder: id, icon: 'circle' })
const STATUSES = [status(1, 'Doing'), status(2, 'Waiting')]
const settings = { urgentRange: 3 as const, weekStartsOn: 1 as const }
const options = { lookups: lookupsFor({}), settings, statuses: STATUSES }

let seq = 0
function ev(todoId: number, type: TodoEventType, at: Date, fromValue: string | number | null = null, toValue: string | number | null = null): TodoEvent {
  return { id: ++seq, todoId, type, fromValue, toValue, timestamp: at.toISOString() }
}
const task = (o: Partial<PersistedTodoItem> & { id: number }) => makeTodo({ createdAt: OLD, modifiedAt: OLD, ...o })

describe('statusFlowDays', () => {
  it('each week’s last day, oldest first; this week ends today', () => {
    // Weeks from Monday: this week Mon 5 – today Sat 10.
    expect(statusFlowDays(today, 3, 1)).toEqual([new Date(2026, 8, 27), new Date(2026, 9, 4), today])
    expect(statusFlowDays(today, 8, 1)).toHaveLength(8)
  })
})

describe('computeStatusFlow', () => {
  const days = statusFlowDays(today, 3, 1) // Sun 27 Sep, Sun 4 Oct, Sat 10 Oct

  it('replays each task’s status to each week’s end; open tasks only; Settings order, No status last', () => {
    const tasks = [
      // Waiting now; Doing until Wed 30 Sep.
      task({ id: 1, statusId: 2 }),
      // Created Tue 6 Oct, Doing.
      task({ id: 2, statusId: 1, createdAt: new Date(2026, 9, 6, 9) }),
      // No status throughout.
      task({ id: 3 }),
      // Completed Thu 1 Oct: open the first week only.
      task({ id: 4, statusId: 1, isCompleted: true, completedAt: new Date(2026, 9, 1, 12) }),
      // A status deleted since: No status.
      task({ id: 5, statusId: 99 }),
    ]
    const events = [
      ev(1, 'status', new Date(2026, 8, 30, 12), 1, 2),
      ev(2, 'created', new Date(2026, 9, 6, 9)),
      ev(4, 'completed', new Date(2026, 9, 1, 12)),
    ]
    const out = computeStatusFlow([NO_FILTER], tasks, events, days, options)
    expect(out.bands.map((b) => b.label)).toEqual(['Doing', 'Waiting', 'No status'])
    expect(out.bands.at(-1)).toEqual(NO_STATUS_BAND)
    const at = (i: number) => Object.fromEntries([...(out.weeks[i]?.byBand ?? [])].map(([k, ids]) => [k, ids]))
    expect(at(0)).toEqual({ 1: [1, 4], none: [3, 5] })
    expect(at(1)).toEqual({ 2: [1], none: [3, 5] })
    expect(at(2)).toEqual({ 1: [2], 2: [1], none: [3, 5] })
    expect(out.weeks.map((w) => w.total)).toEqual([4, 3, 4])
    expect(out.max).toBe(4)
  })

  it('the filter is evaluated with each week’s end as today: overdue then', () => {
    const due = new Date(2026, 9, 2)
    const tasks = [task({ id: 1, statusId: 1, dueDate: due })]
    const overdue: FilterCriteria = { ...NO_FILTER, dates: { deadline: { match: 'range', start: null, end: { kind: 'relative', token: 'yesterday' } } } }
    const out = computeStatusFlow([overdue], tasks, [], days, options)
    expect(out.weeks.map((w) => w.total)).toEqual([0, 1, 1])
  })

  it('no days or no tasks: nothing counted', () => {
    expect(computeStatusFlow([NO_FILTER], [], [], days, options)).toMatchObject({ bands: [], max: 0 })
    expect(computeStatusFlow([NO_FILTER], [task({ id: 1 })], [], [], options)).toEqual({ weeks: [], bands: [], max: 0 })
  })
})
