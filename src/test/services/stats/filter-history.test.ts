import { describe, expect, it } from 'vitest'
import type { Person, PersistedTodoItem, Tag, TodoEvent, TodoEventType } from '../../../models'
import { computeMetricHistory } from '../../../services/stats/metric-history'
import { filterHistory, filterHistoryFields, historyExactness, type FilterHistoryOptions } from '../../../services/stats/filter-history'
import { eventsByTask, taskAsOf, taskFieldReplay } from '../../../services/stats/task-history'
import { composeScreenFilter, type FilterCriteria } from '../../../utils/filter-criteria'
import { addDays } from '../../../utils/calendar-grid'
import { FILTER_HISTORY_EVENT_TYPES, METRIC_HISTORY_DAYS } from '../../../utils/trend-window'
import { emptyFilterCriteria, lookupsFor, makeTodo } from '../../helpers'

/**
 * The history log H3's replay (D26 P7): every logged field per day, and
 * any filter's count at each day's end — what P5's Number sparklines and
 * P8's charts build on.
 */

const today = new Date(2026, 9, 10) // Sat 10 Oct
/** Day `n` of the 14-day window (0 = Sun 27 Sep, 13 = today), at `hour`. */
const hd = (n: number, hour = 12) => new Date(2026, 8, 27 + n, hour)
const first = hd(0, 0)
const DAYS = Array.from({ length: METRIC_HISTORY_DAYS }, (_, i) => addDays(first, i))
const OLD = new Date(2026, 0, 1)
const ANN = 1
const BEN = 2
const OPS = 7

let seq = 0
function ev(todoId: number, type: TodoEventType, at: Date, fromValue: string | number | null = null, toValue: string | number | null = null): TodoEvent {
  return { id: ++seq, todoId, type, fromValue, toValue, timestamp: at.toISOString() }
}
const iso = (d: Date) => d.toISOString()

function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: OLD, ...overrides })
}

const person = (id: number): Person => ({ id, name: `P${id}`, initials: `P${id}` })
const tag = (id: number): Tag => ({ id, name: `T${id}`, color: '#fff' })

function options(people: Record<number, number[]> = {}, tags: Record<number, number[]> = {}): FilterHistoryOptions {
  return {
    lookups: lookupsFor({
      assignedPeopleMap: new Map(Object.entries(people).map(([k, ids]) => [Number(k), ids.map(person)])),
      assignedTagsMap: new Map(Object.entries(tags).map(([k, ids]) => [Number(k), ids.map(tag)])),
    }),
    settings: { urgentRange: null, weekStartsOn: 0 },
  }
}

const criteria = (patch: Partial<FilterCriteria>): FilterCriteria => ({ ...emptyFilterCriteria, ...patch })

describe('taskFieldReplay', () => {
  // One task through a mixed sequence: every field changes at least once.
  const t = task({
    id: 1, dueDate: hd(20, 0), nextFollowupAt: hd(16, 0), lastFollowupAt: hd(9, 15),
    statusId: 3, urgent: true, focus: true,
  })
  const events = [
    ev(1, 'deadline', hd(4), iso(hd(2, 0)), iso(hd(20, 0))),
    ev(1, 'followup', hd(6), null, iso(hd(12, 0))),
    ev(1, 'person', hd(6), null, ANN),
    ev(1, 'marker', hd(7), 'urgent', 'urgent,focus'),
    ev(1, 'status', hd(8), 2, 3),
    ev(1, 'followedUp', hd(9, 15), null, iso(hd(9, 15))),
    ev(1, 'followup', hd(9, 15), iso(hd(12, 0)), iso(hd(16, 0))),
    ev(1, 'tag', hd(10), null, OPS),
    ev(1, 'person', hd(11), BEN, null),
    ev(1, 'completed', hd(11)),
    ev(1, 'reopened', hd(12)),
  ]
  const byTask = eventsByTask(events, new Set([1]), FILTER_HISTORY_EVENT_TYPES, first)
  const at = taskFieldReplay(t, byTask.get(1), { personIds: [ANN], tagIds: [OPS] }, first)

  it('reads each field back to the day’s end', () => {
    expect(at(3)).toMatchObject({
      state: 'open', dueDate: hd(2, 0), nextFollowupAt: null, lastFollowupAt: null, statusId: 2,
      markers: { urgent: true, important: false, focus: false },
    })
    expect([...at(3)!.personIds].sort()).toEqual([BEN])
    expect(at(3)!.tagIds).toEqual([])
    expect(at(6)).toMatchObject({ dueDate: hd(20, 0), nextFollowupAt: hd(12, 0), statusId: 2 })
    expect([...at(6)!.personIds].sort()).toEqual([ANN, BEN])
    expect(at(9)).toMatchObject({ statusId: 3, lastFollowupAt: hd(9, 15), nextFollowupAt: hd(16, 0), markers: { urgent: true, focus: true } })
    expect(at(10)!.tagIds).toEqual([OPS])
    expect(at(11)).toMatchObject({ state: 'done', completed: hd(11) })
    expect(at(11)!.personIds).toEqual([ANN])
  })

  it('the last day reads the task as it is now', () => {
    expect(at(13)).toEqual({
      state: 'open', completed: null, dueDate: hd(20, 0), nextFollowupAt: hd(16, 0), lastFollowupAt: hd(9, 15),
      statusId: 3, markers: { urgent: true, important: false, focus: true }, personIds: [ANN], tagIds: [OPS],
    })
  })

  it('before its created event the task is absent', () => {
    const fresh = task({ id: 2, createdAt: hd(5) })
    const created = eventsByTask([ev(2, 'created', hd(5)), ev(2, 'person', hd(5), null, ANN)], new Set([2]), FILTER_HISTORY_EVENT_TYPES, first)
    const replay = taskFieldReplay(fresh, created.get(2), { personIds: [ANN], tagIds: [] }, first)
    expect(replay(4)).toBeNull()
    expect(replay(5)?.personIds).toEqual([ANN])
  })

  it('a field with no event (before the log began) reads as it is now', () => {
    const quiet = task({ id: 3, nextFollowupAt: hd(1, 0), important: true })
    const replay = taskFieldReplay(quiet, undefined, { personIds: [BEN], tagIds: [OPS] }, first)
    expect(replay(0)).toMatchObject({ nextFollowupAt: hd(1, 0), markers: { important: true }, personIds: [BEN], tagIds: [OPS] })
  })

  it('taskAsOf: the row a filter reads that day, the unlogged fields as now', () => {
    const row = taskAsOf(t, at(3)!)
    expect(row).toMatchObject({ id: 1, title: t.title, isCompleted: false, dueDate: hd(2, 0), statusId: 2, urgent: true })
    expect(row.focus).toBeUndefined()
    expect(row.nextFollowupAt).toBeUndefined()
    expect(taskAsOf(t, at(11)!)).toMatchObject({ isCompleted: true, completedAt: hd(11) })
  })
})

describe('filterHistory', () => {
  it('counts a person filter by the day’s people', () => {
    const tasks = [task({ id: 1 }), task({ id: 2 })]
    const events = [ev(1, 'person', hd(3), null, ANN), ev(2, 'person', hd(8), ANN, null)]
    const counts = filterHistory(criteria({ personIds: new Set([ANN]) }), tasks, events, DAYS, options({ 1: [ANN] }))
    expect(counts).toEqual([1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1])
  })

  it('evaluates relative dates against each day: overdue then, not now', () => {
    const tasks = [task({ id: 1, dueDate: hd(5, 0) })]
    const overdue = criteria({ dates: { deadline: { match: 'range', start: null, end: { kind: 'relative', token: 'yesterday' } } } })
    expect(filterHistory(overdue, tasks, [], DAYS, options())).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('a follow-up, a marker and a tag filter follow their events', () => {
    const tasks = [task({ id: 1, nextFollowupAt: hd(30, 0), focus: true })]
    const events = [
      ev(1, 'followup', hd(4), null, iso(hd(30, 0))),
      ev(1, 'marker', hd(6), null, 'focus'),
      ev(1, 'tag', hd(9), null, OPS),
    ]
    const o = options({}, { 1: [OPS] })
    expect(filterHistory(criteria({ dates: { followup: { match: 'set' } } }), tasks, events, DAYS, o)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(filterHistory(criteria({ markers: [{ values: ['focus'] }] }), tasks, events, DAYS, o)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(filterHistory(criteria({ expression: { kind: 'tag', id: OPS } }), tasks, events, DAYS, o)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
  })

  it('stages must all pass (a Number’s filter under the screen filter)', () => {
    const tasks = [task({ id: 1, statusId: 3 }), task({ id: 2, statusId: 3 })]
    const events = [ev(1, 'status', hd(10), 2, 3)]
    const stages = composeScreenFilter(criteria({ personIds: new Set([ANN]) }), criteria({ statusIds: new Set([3]) }))
    expect(filterHistory(stages, tasks, events, DAYS, options({ 1: [ANN], 2: [BEN] }))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1])
  })

  it('no days: no counts', () => {
    expect(filterHistory(emptyFilterCriteria, [task({ id: 1 })], [], [], options())).toEqual([])
  })

  it('reads the same as the Numbers’ history for Open, Overdue, Due today and Closed this week', () => {
    const tasks = [
      task({ id: 1, dueDate: hd(6, 0) }),
      task({ id: 2, createdAt: hd(3, 9), dueDate: hd(13, 0) }),
      task({ id: 3, isCompleted: true, completedAt: hd(9), dueDate: hd(2, 0) }),
      task({ id: 4, dueDate: hd(4, 0) }),
      task({ id: 5, isCompleted: true, completedAt: hd(12, 8) }),
      task({ id: 6, dueDate: hd(11, 0) }),
    ]
    const events = [
      ev(2, 'created', hd(3, 9)),
      ev(3, 'completed', hd(9)),
      ev(4, 'deadline', hd(8), iso(hd(1, 0)), iso(hd(4, 0))),
      ev(6, 'completed', hd(5)), ev(6, 'reopened', hd(7)),
      ev(5, 'completed', hd(12, 8)),
    ]
    const metric = computeMetricHistory(tasks, events, { today, weekStartsOn: 0 }).series
    const o = options()
    const open = filterHistory(emptyFilterCriteria, tasks, events, DAYS, o)
    const overdue = filterHistory(criteria({ dates: { deadline: { match: 'range', start: null, end: { kind: 'relative', token: 'yesterday' } } } }), tasks, events, DAYS, o)
    const dueToday = filterHistory(criteria({ dates: { deadline: { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'relative', token: 'today' } } } }), tasks, events, DAYS, o)
    const closed = filterHistory(criteria({ dates: { completed: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: { kind: 'relative', token: 'today' } } } }), tasks, events, DAYS, o)
    expect(open).toEqual(metric.open)
    expect(overdue).toEqual(metric.overdue)
    expect(dueToday).toEqual(metric.dueToday)
    expect(closed).toEqual(metric.closedThisWeek)
  })
})

describe('historyExactness', () => {
  const since = new Date(2026, 8, 20, 10) // Sun 20 Sep, mid-morning
  const people = criteria({ personIds: new Set([ANN]) })

  it('what a filter reads: its clauses, its expression and its lens', () => {
    expect([...filterHistoryFields(emptyFilterCriteria)]).toEqual(['state'])
    const f = criteria({
      statusIds: new Set([1]),
      expression: { kind: 'or', items: [{ kind: 'priority', value: 'focus' }, { kind: 'date', field: 'lastFollowup', match: { match: 'set' } }] },
      lens: criteria({ searchText: 'call' }),
    })
    expect([...filterHistoryFields(f)].sort()).toEqual(['due', 'lastFollowup', 'markers', 'state', 'status', 'text'])
  })

  it('the always-logged fields are exact on any window', () => {
    const f = criteria({ statusIds: new Set([1]), dates: { deadline: { match: 'set' }, completed: { match: 'set' }, created: { match: 'set' } } })
    expect(historyExactness(f, first, null)).toEqual({ exact: true, approximate: [] })
  })

  it('the H3 fields are exact once the log began on or before the first day', () => {
    expect(historyExactness(people, first, since).exact).toBe(true)
    expect(historyExactness(people, new Date(2026, 8, 20), since).exact).toBe(true) // began during the first day
    expect(historyExactness(people, new Date(2026, 8, 19), since)).toEqual({ exact: false, approximate: ['people'] })
    expect(historyExactness(people, first, null)).toEqual({ exact: false, approximate: ['people'] })
  })

  it('text and the modified date are never exact', () => {
    expect(historyExactness(criteria({ searchText: 'call' }), first, since)).toEqual({ exact: false, approximate: ['text'] })
    expect(historyExactness([emptyFilterCriteria, criteria({ dates: { modified: { match: 'set' } } })], first, since).approximate).toEqual(['modified'])
  })
})
