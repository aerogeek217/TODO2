import { describe, expect, it } from 'vitest'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { Person, PersistedTodoItem, Status, Tag, TodoPredicate } from '../../../models'
import {
  CHECKIN_DUE_SOON_DAYS,
  checkinTaskCount,
  compareCheckinTasks,
  selectCheckinTasks,
  type CheckinSelectContext,
} from '../../../services/checkin-email/select'
import type { CheckinTaskScope } from '../../../utils/checkin-settings'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { makePerson, makeTodo } from '../../helpers'

// Monday 12 Oct 2026, mid-afternoon: only the day counts.
const today = new Date(2026, 9, 12, 15, 30)
const day = (offset: number) => new Date(2026, 9, 12 + offset)

const ada = makePerson({ id: 1, name: 'Ada Lovelace' })
const bob = makePerson({ id: 2, name: 'Bob Stone' })

const basePredicate: TodoPredicate = {
  showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null,
}

function list(id: number, predicate: Partial<TodoPredicate>, extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id, name: `List ${id}`, sortOrder: id, sort: 'name', grouping: 'status', 
    membership: { kind: 'custom', predicate: { ...basePredicate, ...predicate } },
    ...extra,
  }
}

function context(
  todos: PersistedTodoItem[],
  assignments: Record<number, Person[]>,
  extra: Partial<CheckinSelectContext> = {},
): CheckinSelectContext {
  return {
    todos,
    today,
    assignedPeopleMap: new Map(Object.entries(assignments).map(([id, people]) => [Number(id), people])),
    listDefinitions: [],
    markerSettings: { urgentRange: 3, hotRule: DEFAULT_HOT_RULE },
    weekStartsOn: 1,
    ...extra,
  }
}

const ids = (todos: PersistedTodoItem[]) => todos.map((t) => t.id)
const ALL: CheckinTaskScope = { kind: 'all' }

describe('selectCheckinTasks', () => {
  it('takes only open tasks assigned to the person', () => {
    const todos = [
      makeTodo({ id: 1 }),
      makeTodo({ id: 2 }),
      makeTodo({ id: 3, isCompleted: true }),
      makeTodo({ id: 4 }),
    ]
    const ctx = context(todos, { 1: [ada], 2: [bob], 3: [ada], 4: [bob, ada] })
    const out = selectCheckinTasks(ada, ALL, ctx)
    expect([...ids(out.overdue), ...ids(out.comingUp)].sort()).toEqual([1, 4])
    expect(checkinTaskCount(out)).toBe(2)
  })

  it('Overdue = due date before today; a late follow-up or a due date today is Coming up', () => {
    const todos = [
      makeTodo({ id: 1, dueDate: day(-1) }),
      makeTodo({ id: 2, dueDate: day(0) }),
      makeTodo({ id: 3, nextFollowupAt: day(-5) }),
      makeTodo({ id: 4, dueDate: day(3), nextFollowupAt: day(-2) }),
      makeTodo({ id: 5, dueDate: day(-30) }),
    ]
    const ctx = context(todos, { 1: [ada], 2: [ada], 3: [ada], 4: [ada], 5: [ada] })
    const out = selectCheckinTasks(ada, ALL, ctx)
    expect(ids(out.overdue)).toEqual([5, 1])
    expect(ids(out.comingUp)).toEqual([3, 4, 2])
  })

  it('orders by the earlier of due / next follow-up, undated last, then sortOrder', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 5 }),
      makeTodo({ id: 2, sortOrder: 1 }),
      makeTodo({ id: 3, dueDate: day(10), nextFollowupAt: day(2), sortOrder: 9 }),
      makeTodo({ id: 4, dueDate: day(2), sortOrder: 3 }),
      makeTodo({ id: 5, nextFollowupAt: day(4), sortOrder: 0 }),
    ]
    const ctx = context(todos, { 1: [ada], 2: [ada], 3: [ada], 4: [ada], 5: [ada] })
    expect(ids(selectCheckinTasks(ada, ALL, ctx).comingUp)).toEqual([4, 3, 5, 2, 1])
    expect(compareCheckinTasks(todos[0]!, todos[0]!)).toBe(0)
  })

  it('due-soon: overdue, or due / following up on or before today + 14 days', () => {
    const todos = [
      makeTodo({ id: 1, dueDate: day(-3) }),
      makeTodo({ id: 2, dueDate: day(CHECKIN_DUE_SOON_DAYS) }),
      makeTodo({ id: 3, dueDate: day(CHECKIN_DUE_SOON_DAYS + 1) }),
      makeTodo({ id: 4, nextFollowupAt: day(CHECKIN_DUE_SOON_DAYS) }),
      makeTodo({ id: 5, nextFollowupAt: day(CHECKIN_DUE_SOON_DAYS + 1) }),
      makeTodo({ id: 6, nextFollowupAt: day(-4) }),
      makeTodo({ id: 7 }),
      makeTodo({ id: 8, dueDate: day(40), nextFollowupAt: day(1) }),
    ]
    const people = Object.fromEntries(todos.map((t) => [t.id, [ada]]))
    const out = selectCheckinTasks(ada, { kind: 'due-soon' }, context(todos, people))
    expect(ids(out.overdue)).toEqual([1])
    expect(ids(out.comingUp)).toEqual([6, 8, 2, 4])
  })

  it('hot: the Settings Hot rule, with Urgent from the flag or the due-date range', () => {
    const todos = [
      makeTodo({ id: 1, urgent: true, important: true }),
      makeTodo({ id: 2, focus: true }),
      makeTodo({ id: 3, important: true }),
      makeTodo({ id: 4, important: true, dueDate: day(2) }),
      makeTodo({ id: 5, urgent: true }),
    ]
    const people = Object.fromEntries(todos.map((t) => [t.id, [ada]]))
    const out = selectCheckinTasks(ada, { kind: 'hot' }, context(todos, people))
    expect([...ids(out.overdue), ...ids(out.comingUp)].sort()).toEqual([1, 2, 4])
    const narrowRange = context(todos, people, { markerSettings: { urgentRange: 1, hotRule: DEFAULT_HOT_RULE } })
    expect([...ids(selectCheckinTasks(ada, { kind: 'hot' }, narrowRange).comingUp)].sort()).toEqual([1, 2])
    const focusOnly = context(todos, people, { markerSettings: { urgentRange: 3, hotRule: [{ urgent: true }] } })
    expect([...ids(selectCheckinTasks(ada, { kind: 'hot' }, focusOnly).comingUp)].sort()).toEqual([1, 4, 5])
  })

  it('list: the list filter on top of open + assigned; the list sort and grouping are ignored', () => {
    const tag: Tag = { id: 7, name: 'docs', color: '#fff' }
    const todos = [
      makeTodo({ id: 1, title: 'b', dueDate: day(5) }),
      makeTodo({ id: 2, title: 'a', dueDate: day(1) }),
      makeTodo({ id: 3, title: 'c' }),
      makeTodo({ id: 4, title: 'd', isCompleted: true }),
      makeTodo({ id: 5, title: 'e' }),
    ]
    const ctx = context(todos, { 1: [ada], 2: [ada], 3: [ada], 4: [ada], 5: [bob] }, {
      assignedTagsMap: new Map([[1, [tag]], [2, [tag]], [4, [tag]], [5, [tag]]]),
      listDefinitions: [list(9, { tags: [7], showCompleted: true })],
    })
    const out = selectCheckinTasks(ada, { kind: 'list', listDefinitionId: 9 }, ctx)
    expect(ids(out.comingUp)).toEqual([2, 1])
  })

  it('list: a status clause reads the statuses; a person clause narrows on top of the person', () => {
    const waiting: Status = { id: 3, name: 'Waiting', color: '#fff', sortOrder: 0 }
    const todos = [makeTodo({ id: 1, statusId: 3 }), makeTodo({ id: 2 }), makeTodo({ id: 3, statusId: 3 })]
    const ctx = context(todos, { 1: [ada], 2: [ada], 3: [ada, bob] }, {
      statuses: [waiting],
      listDefinitions: [list(1, { statusIds: [3] }), list(2, { personIds: [2] })],
    })
    expect(ids(selectCheckinTasks(ada, { kind: 'list', listDefinitionId: 1 }, ctx).comingUp)).toEqual([1, 3])
    expect(ids(selectCheckinTasks(ada, { kind: 'list', listDefinitionId: 2 }, ctx).comingUp)).toEqual([3])
  })

  it('list: "is not" clauses leave out the ticked status / people', () => {
    const waiting: Status = { id: 3, name: 'Waiting', color: '#fff', sortOrder: 0 }
    const todos = [makeTodo({ id: 1, statusId: 3 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const ctx = context(todos, { 1: [ada], 2: [ada], 3: [ada, bob] }, {
      statuses: [waiting],
      listDefinitions: [
        list(1, { statusIds: [3], negate: { statusIds: true } }),
        list(2, { personIds: [2], negate: { personIds: true } }),
      ],
    })
    expect(ids(selectCheckinTasks(ada, { kind: 'list', listDefinitionId: 1 }, ctx).comingUp)).toEqual([2, 3])
    expect(ids(selectCheckinTasks(ada, { kind: 'list', listDefinitionId: 2 }, ctx).comingUp)).toEqual([1, 2])
  })

  it('list with a prompt: a person prompt gets this person; other prompts narrow nothing', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const ctx = context(todos, { 1: [ada], 2: [ada, bob], 3: [bob] }, {
      listDefinitions: [
        list(1, { personIds: [2] }, { runtimeFilter: { field: 'person' } }),
        list(2, {}, { runtimeFilter: { field: 'status' } }),
      ],
    })
    // The prompt pick replaces the list's own person clause, as a List widget does.
    expect(ids(selectCheckinTasks(ada, { kind: 'list', listDefinitionId: 1 }, ctx).comingUp)).toEqual([1, 2])
    expect(ids(selectCheckinTasks(ada, { kind: 'list', listDefinitionId: 2 }, ctx).comingUp)).toEqual([1, 2])
  })

  it('a list that no longer exists falls back to all open tasks', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2, important: true })]
    const ctx = context(todos, { 1: [ada], 2: [ada] }, { listDefinitions: [list(1, { markers: { important: true } })] })
    expect(ids(selectCheckinTasks(ada, { kind: 'list', listDefinitionId: 1 }, ctx).comingUp)).toEqual([2])
    expect(ids(selectCheckinTasks(ada, { kind: 'list', listDefinitionId: 99 }, ctx).comingUp)).toEqual([1, 2])
  })

  it('a person with no tasks gets empty sections', () => {
    const out = selectCheckinTasks(ada, ALL, context([makeTodo({ id: 1 })], { 1: [bob] }))
    expect(out).toEqual({ overdue: [], comingUp: [] })
  })
})
