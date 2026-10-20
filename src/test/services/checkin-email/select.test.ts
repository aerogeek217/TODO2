import { describe, expect, it } from 'vitest'
import type { Person, PersistedTodoItem, Status, Tag, TodoPredicate } from '../../../models'
import {
  checkinTaskCount,
  compareCheckinTasks,
  selectCheckinTasks,
  type CheckinSelectContext,
} from '../../../services/checkin-email/select'
import { CHECKIN_DUE_SOON_DAYS, dueSoonCheckinFilter } from '../../../utils/checkin-settings'
import { emptyPredicate } from '../../../models/filter-predicate'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { makePerson, makeTodo } from '../../helpers'

// Monday 12 Oct 2026, mid-afternoon: only the day counts.
const today = new Date(2026, 9, 12, 15, 30)
const day = (offset: number) => new Date(2026, 9, 12 + offset)

const ada = makePerson({ id: 1, name: 'Ada Lovelace' })
const bob = makePerson({ id: 2, name: 'Bob Stone' })

const filter = (extra: Partial<TodoPredicate> = {}): TodoPredicate => ({ ...emptyPredicate(), ...extra })

function context(
  todos: PersistedTodoItem[],
  assignments: Record<number, Person[]>,
  extra: Partial<CheckinSelectContext> = {},
): CheckinSelectContext {
  return {
    todos,
    today,
    assignedPeopleMap: new Map(Object.entries(assignments).map(([id, people]) => [Number(id), people])),
    markerSettings: { urgentRange: 3, hotRule: DEFAULT_HOT_RULE },
    weekStartsOn: 1,
    ...extra,
  }
}

const ids = (todos: PersistedTodoItem[]) => todos.map((t) => t.id)
const ALL = filter()

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

  it('“Overdue + next 2 weeks”: due before today or on or before today + 14 days (by the due date only)', () => {
    const todos = [
      makeTodo({ id: 1, dueDate: day(-3) }),
      makeTodo({ id: 2, dueDate: day(CHECKIN_DUE_SOON_DAYS) }),
      makeTodo({ id: 3, dueDate: day(CHECKIN_DUE_SOON_DAYS + 1) }),
      makeTodo({ id: 4, nextFollowupAt: day(CHECKIN_DUE_SOON_DAYS) }),
      makeTodo({ id: 7 }),
      makeTodo({ id: 8, dueDate: day(1), nextFollowupAt: day(40) }),
    ]
    const people = Object.fromEntries(todos.map((t) => [t.id, [ada]]))
    const out = selectCheckinTasks(ada, dueSoonCheckinFilter(), context(todos, people))
    expect(ids(out.overdue)).toEqual([1])
    expect(ids(out.comingUp)).toEqual([8, 2])
  })

  it('Priority Hot: the Settings Hot rule, with Urgent from the flag or the due-date range', () => {
    const todos = [
      makeTodo({ id: 1, urgent: true, important: true }),
      makeTodo({ id: 2, focus: true }),
      makeTodo({ id: 3, important: true }),
      makeTodo({ id: 4, important: true, dueDate: day(2) }),
      makeTodo({ id: 5, urgent: true }),
    ]
    const people = Object.fromEntries(todos.map((t) => [t.id, [ada]]))
    const hot = filter({ markers: 'hot' })
    const out = selectCheckinTasks(ada, hot, context(todos, people))
    expect([...ids(out.overdue), ...ids(out.comingUp)].sort()).toEqual([1, 2, 4])
    const narrowRange = context(todos, people, { markerSettings: { urgentRange: 1, hotRule: DEFAULT_HOT_RULE } })
    expect([...ids(selectCheckinTasks(ada, hot, narrowRange).comingUp)].sort()).toEqual([1, 2])
    const urgentOnly = context(todos, people, { markerSettings: { urgentRange: 3, hotRule: [{ urgent: true }] } })
    expect([...ids(selectCheckinTasks(ada, hot, urgentOnly).comingUp)].sort()).toEqual([1, 4, 5])
  })

  it('a filter on top of open + assigned; it never shows completed tasks', () => {
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
    })
    const out = selectCheckinTasks(ada, filter({ tags: [7], showCompleted: true }), ctx)
    expect(ids(out.comingUp)).toEqual([2, 1])
  })

  it('a status clause reads the statuses; a people clause is ignored (the check-in is the person’s)', () => {
    const waiting: Status = { id: 3, name: 'Waiting', color: '#fff', sortOrder: 0 }
    const todos = [makeTodo({ id: 1, statusId: 3 }), makeTodo({ id: 2 }), makeTodo({ id: 3, statusId: 3 })]
    const ctx = context(todos, { 1: [ada], 2: [ada], 3: [ada, bob] }, { statuses: [waiting] })
    expect(ids(selectCheckinTasks(ada, filter({ statusIds: [3] }), ctx).comingUp)).toEqual([1, 3])
    expect(ids(selectCheckinTasks(ada, filter({ personIds: [2] }), ctx).comingUp)).toEqual([1, 2, 3])
    expect(ids(selectCheckinTasks(ada, filter({ personIds: [2], negate: { personIds: true } }), ctx).comingUp)).toEqual([1, 2, 3])
  })

  it('“is not” clauses leave out the ticked status', () => {
    const waiting: Status = { id: 3, name: 'Waiting', color: '#fff', sortOrder: 0 }
    const todos = [makeTodo({ id: 1, statusId: 3 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const ctx = context(todos, { 1: [ada], 2: [ada], 3: [ada, bob] }, { statuses: [waiting] })
    expect(ids(selectCheckinTasks(ada, filter({ statusIds: [3], negate: { statusIds: true } }), ctx).comingUp)).toEqual([2, 3])
  })

  it('a Priority No leaves out the tasks with that marker', () => {
    const todos = [makeTodo({ id: 1, important: true }), makeTodo({ id: 2, urgent: true }), makeTodo({ id: 3, urgent: true, important: true })]
    const ctx = context(todos, { 1: [ada], 2: [ada], 3: [ada] })
    expect(ids(selectCheckinTasks(ada, filter({ markers: { urgent: true, important: false } }), ctx).comingUp)).toEqual([2])
  })

  it('a person with no tasks gets empty sections', () => {
    const out = selectCheckinTasks(ada, ALL, context([makeTodo({ id: 1 })], { 1: [bob] }))
    expect(out).toEqual({ overdue: [], comingUp: [] })
  })
})
