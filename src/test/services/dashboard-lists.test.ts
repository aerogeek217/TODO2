import { describe, it, expect } from 'vitest'
import {
  buildDashboardLists,
  interpretMembership,
  type DashboardListsContext,
} from '../../services/dashboard-lists'
import { resolveFuzzy } from '../../utils/effective-date'
import { MS_PER_DAY, startOfDay } from '../../utils/date'
import type { PersistedTodoItem, Status } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'

const today = startOfDay(new Date('2026-04-13T12:00:00'))

const hiddenStatusId = 101
const visibleStatusId = 100

const statuses: Status[] = [
  { id: visibleStatusId, name: 'Follow-up', color: '#F5A623', sortOrder: 0, icon: 'message-bubble', hideByDefault: false },
  { id: hiddenStatusId, name: 'Assigned', color: '#537FE7', sortOrder: 1, icon: 'person', hideByDefault: true },
]

function makeCtx(overrides: Partial<DashboardListsContext> = {}): DashboardListsContext {
  return {
    today,
    hiddenStatusIds: new Set(statuses.filter((s) => s.hideByDefault).map((s) => s.id!)),
    showHiddenStatuses: false,
    showCompleted: false,
    ...overrides,
  }
}

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    isCompleted: false,
    sortOrder: overrides.id * 1000,
    createdAt: new Date(today),
    modifiedAt: new Date(today),
    ...overrides,
  } as PersistedTodoItem
}

const TODAY_DEF: PersistedListDefinition = {
  id: 1,
  seededKey: 'today',
  name: 'Today',
  sortOrder: 0,
  membership: { kind: 'today' },
  sort: { kind: 'effective-date-asc' },
  grouping: { kind: 'none' },
}
const UPCOMING_DEF: PersistedListDefinition = {
  id: 2,
  seededKey: 'upcoming',
  name: 'Upcoming',
  sortOrder: 1,
  membership: { kind: 'upcoming' },
  sort: { kind: 'effective-date-asc' },
  grouping: { kind: 'relative-effective' },
}
const DEADLINES_DEF: PersistedListDefinition = {
  id: 3,
  seededKey: 'deadlines',
  name: 'Deadlines',
  sortOrder: 2,
  membership: { kind: 'deadlines' },
  sort: { kind: 'deadline-asc' },
  grouping: { kind: 'relative-deadline' },
}
const SOMEDAY_DEF: PersistedListDefinition = {
  id: 4,
  seededKey: 'someday',
  name: 'Someday',
  sortOrder: 3,
  membership: { kind: 'someday' },
  sort: { kind: 'sort-order' },
  grouping: { kind: 'none' },
}

const ALL_DEFS = [TODAY_DEF, UPCOMING_DEF, DEADLINES_DEF, SOMEDAY_DEF]

describe('buildDashboardLists', () => {
  it('returns empty array when no definitions', () => {
    expect(buildDashboardLists([], [makeTodo({ id: 1 })], makeCtx())).toEqual([])
  })

  it('renders definitions in sortOrder', () => {
    const lists = buildDashboardLists(ALL_DEFS, [], makeCtx())
    expect(lists.map((l) => l.key)).toEqual(['today', 'upcoming', 'deadlines', 'someday'])
  })

  it('falls back to def-{id} key when seededKey absent', () => {
    const custom: PersistedListDefinition = {
      id: 99,
      name: 'Custom',
      sortOrder: 0,
      membership: { kind: 'someday' },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    }
    const lists = buildDashboardLists([custom], [], makeCtx())
    expect(lists[0]?.key).toBe('def-99')
  })
})

describe('interpretMembership — gates', () => {
  it('excludes completed tasks by default', () => {
    const t = makeTodo({ id: 1, isCompleted: true })
    expect(interpretMembership({ kind: 'someday' }, t, makeCtx())).toBe(false)
  })

  it('includes completed when showCompleted is true', () => {
    const t = makeTodo({ id: 1, isCompleted: true })
    expect(interpretMembership({ kind: 'someday' }, t, makeCtx({ showCompleted: true }))).toBe(true)
  })

  it('excludes tasks with hideByDefault status by default', () => {
    const t = makeTodo({ id: 1, statusId: hiddenStatusId })
    expect(interpretMembership({ kind: 'someday' }, t, makeCtx())).toBe(false)
  })

  it('includes hidden-status tasks when showHiddenStatuses is true', () => {
    const t = makeTodo({ id: 1, statusId: hiddenStatusId })
    expect(interpretMembership({ kind: 'someday' }, t, makeCtx({ showHiddenStatuses: true }))).toBe(true)
  })

  it('includes non-hideByDefault statuses regardless', () => {
    const t = makeTodo({ id: 1, statusId: visibleStatusId })
    expect(interpretMembership({ kind: 'someday' }, t, makeCtx())).toBe(true)
  })
})

describe('interpretMembership — today', () => {
  it('includes tasks scheduled today (precise)', () => {
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: today } })
    expect(interpretMembership({ kind: 'today' }, t, makeCtx())).toBe(true)
  })

  it('includes tasks scheduled in the past (precise)', () => {
    const yesterday = new Date(today.getTime() - MS_PER_DAY)
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: yesterday } })
    expect(interpretMembership({ kind: 'today' }, t, makeCtx())).toBe(true)
  })

  it('includes tasks with deadline within warning window (+3 days)', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 3 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'today' }, t, makeCtx())).toBe(true)
  })

  it('excludes tasks with deadline just outside warning window (+4 days)', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 4 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'today' }, t, makeCtx())).toBe(false)
  })

  it('includes overdue deadlines', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 5 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'today' }, t, makeCtx())).toBe(true)
  })

  it('includes tasks with a past precise scheduledDate', () => {
    const t = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() - 7 * MS_PER_DAY) },
    })
    expect(interpretMembership({ kind: 'today' }, t, makeCtx())).toBe(true)
  })

  it('excludes tasks with no dates', () => {
    const t = makeTodo({ id: 1 })
    expect(interpretMembership({ kind: 'today' }, t, makeCtx())).toBe(false)
  })

  it('excludes tasks scheduled for the future with no deadline', () => {
    const t = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() + 7 * MS_PER_DAY) },
    })
    expect(interpretMembership({ kind: 'today' }, t, makeCtx())).toBe(false)
  })
})

describe('interpretMembership — upcoming', () => {
  it('excludes tasks with no dates (Someday)', () => {
    const t = makeTodo({ id: 1 })
    expect(interpretMembership({ kind: 'upcoming' }, t, makeCtx())).toBe(false)
  })

  it('excludes tasks that are in Today', () => {
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: today } })
    expect(interpretMembership({ kind: 'upcoming' }, t, makeCtx())).toBe(false)
  })

  it('includes tasks with a future scheduledDate beyond Today window', () => {
    const t = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() + 7 * MS_PER_DAY) },
    })
    expect(interpretMembership({ kind: 'upcoming' }, t, makeCtx())).toBe(true)
  })

  it('includes tasks with deadline outside warning window', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 10 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'upcoming' }, t, makeCtx())).toBe(true)
  })
})

describe('interpretMembership — deadlines', () => {
  it('includes any task with a deadline', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 1 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'deadlines' }, t, makeCtx())).toBe(true)
  })

  it('includes tasks also in Today (intentional overlap)', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 2 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'today' }, t, makeCtx())).toBe(true)
    expect(interpretMembership({ kind: 'deadlines' }, t, makeCtx())).toBe(true)
  })

  it('excludes tasks without a deadline', () => {
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: today } })
    expect(interpretMembership({ kind: 'deadlines' }, t, makeCtx())).toBe(false)
  })
})

describe('interpretMembership — someday', () => {
  it('includes tasks with no scheduled and no deadline', () => {
    const t = makeTodo({ id: 1 })
    expect(interpretMembership({ kind: 'someday' }, t, makeCtx())).toBe(true)
  })

  it('excludes any task with a scheduledDate', () => {
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'next-month' } })
    expect(interpretMembership({ kind: 'someday' }, t, makeCtx())).toBe(false)
  })

  it('excludes any task with a deadline', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 30 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'someday' }, t, makeCtx())).toBe(false)
  })
})

describe('buildDashboardLists — overlap + sort', () => {
  it('places a task with deadline today+1 in Today AND Deadlines', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 1 * MS_PER_DAY) })
    const lists = buildDashboardLists(ALL_DEFS, [t], makeCtx())
    const todayList = lists.find((l) => l.key === 'today')!
    const deadlines = lists.find((l) => l.key === 'deadlines')!
    expect(todayList.todos.map((x) => x.id)).toContain(1)
    expect(deadlines.todos.map((x) => x.id)).toContain(1)
  })

  it('sorts Today by effectiveDate ascending (earlier first)', () => {
    const earlier = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() - 2 * MS_PER_DAY) },
    })
    const later = makeTodo({
      id: 2,
      scheduledDate: { kind: 'date', value: today },
    })
    const ctx = makeCtx()
    const lists = buildDashboardLists(ALL_DEFS, [later, earlier], ctx)
    const todayList = lists.find((l) => l.key === 'today')!
    expect(todayList.todos.map((t) => t.id)).toEqual([1, 2])
  })
})

describe('buildDashboardLists — grouping', () => {
  it('drops empty groups', () => {
    const nextWeek = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() + 10 * MS_PER_DAY) },
    })
    const lists = buildDashboardLists([UPCOMING_DEF], [nextWeek], makeCtx())
    const upcoming = lists[0]
    expect(upcoming.groups).toBeDefined()
    expect(upcoming.groups!.length).toBeGreaterThan(0)
    for (const g of upcoming.groups!) {
      expect(g.todos.length).toBeGreaterThan(0)
    }
  })

  it('orders effective-date buckets Tomorrow → This week → Next week → Later this month → Next month → Beyond', () => {
    // Pick today = Wed 2026-04-15 so this-week ends Sun 2026-04-19
    const anchor = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
    const tomorrow = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(anchor.getTime() + 1 * MS_PER_DAY) },
    })
    const thisWeek = makeTodo({
      id: 2,
      scheduledDate: { kind: 'date', value: new Date(anchor.getTime() + 3 * MS_PER_DAY) },
    })
    const nextWeek = makeTodo({
      id: 3,
      scheduledDate: { kind: 'date', value: new Date(anchor.getTime() + 8 * MS_PER_DAY) },
    })
    const laterMonth = makeTodo({
      id: 4,
      scheduledDate: { kind: 'date', value: new Date(anchor.getTime() + 14 * MS_PER_DAY) },
    })
    const nextMonth = makeTodo({
      id: 5,
      scheduledDate: { kind: 'date', value: new Date(anchor.getTime() + 35 * MS_PER_DAY) },
    })
    const beyond = makeTodo({
      id: 6,
      scheduledDate: { kind: 'date', value: new Date(anchor.getTime() + 180 * MS_PER_DAY) },
    })

    const lists = buildDashboardLists(
      [UPCOMING_DEF],
      [tomorrow, thisWeek, nextWeek, laterMonth, nextMonth, beyond],
      makeCtx({ today: anchor }),
    )
    const upcoming = lists[0]
    expect(upcoming.groups!.map((g) => g.key)).toEqual([
      'tomorrow',
      'this-week',
      'next-week',
      'later-month',
      'next-month',
      'beyond',
    ])
  })

  it('returns undefined groups for kind "none"', () => {
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: today } })
    const lists = buildDashboardLists([TODAY_DEF], [t], makeCtx())
    expect(lists[0].groups).toBeUndefined()
  })

  it('deadline bucketing puts overdue first', () => {
    const overdue = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 5 * MS_PER_DAY) })
    const lists = buildDashboardLists([DEADLINES_DEF], [overdue], makeCtx())
    expect(lists[0].groups![0].key).toBe('overdue')
  })
})

describe('buildDashboardLists — no list caps', () => {
  it('returns every matching task (no TOP_N)', () => {
    const future = new Date(today.getTime() + 30 * MS_PER_DAY)
    const todos = Array.from({ length: 47 }, (_, i) =>
      makeTodo({ id: i + 1, scheduledDate: { kind: 'date', value: future } }),
    )
    const lists = buildDashboardLists([UPCOMING_DEF], todos, makeCtx())
    expect(lists[0].todos).toHaveLength(47)
  })
})

describe('buildDashboardLists — visibility gates', () => {
  it('hideByDefault status excluded from all lists by default', () => {
    const t = makeTodo({ id: 1, statusId: hiddenStatusId })
    const lists = buildDashboardLists(ALL_DEFS, [t], makeCtx())
    for (const l of lists) expect(l.todos).toHaveLength(0)
  })

  it('completed tasks excluded from all lists by default', () => {
    const t = makeTodo({ id: 1, isCompleted: true })
    const lists = buildDashboardLists(ALL_DEFS, [t], makeCtx())
    for (const l of lists) expect(l.todos).toHaveLength(0)
  })
})

describe('week boundary parity with resolveFuzzy', () => {
  it('bucketByEffective thisWeekEnd matches resolveFuzzy("this-week")', () => {
    const anchor = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
    // A task at this-week end should land in 'this-week' bucket, not 'next-week'.
    const thisWeekEnd = resolveFuzzy('this-week', anchor)
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: thisWeekEnd } })
    const lists = buildDashboardLists([UPCOMING_DEF], [t], makeCtx({ today: anchor }))
    const upcoming = lists[0]
    const thisWeekGroup = upcoming.groups!.find((g) => g.key === 'this-week')
    expect(thisWeekGroup?.todos.map((x) => x.id)).toContain(1)
  })
})
