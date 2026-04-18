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
  name: 'Today',
  sortOrder: 0,
  pinnedToDashboard: true,
  membership: { kind: 'today' },
  sort: { kind: 'effective-date-asc' },
  grouping: { kind: 'none' },
}
const UPCOMING_DEF: PersistedListDefinition = {
  id: 2,
  name: 'Upcoming',
  sortOrder: 1,
  pinnedToDashboard: true,
  membership: { kind: 'upcoming' },
  sort: { kind: 'effective-date-asc' },
  grouping: { kind: 'relative-effective' },
}
const DEADLINES_DEF: PersistedListDefinition = {
  id: 3,
  name: 'Deadlines',
  sortOrder: 2,
  pinnedToDashboard: true,
  membership: { kind: 'deadlines' },
  sort: { kind: 'deadline-asc' },
  grouping: { kind: 'relative-deadline' },
}
const SOMEDAY_DEF: PersistedListDefinition = {
  id: 4,
  name: 'Someday',
  sortOrder: 3,
  pinnedToDashboard: true,
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
    expect(lists.map((l) => l.id)).toEqual([1, 2, 3, 4])
    expect(lists.map((l) => l.label)).toEqual(['Today', 'Upcoming', 'Deadlines', 'Someday'])
  })

  it('keys every row by def-{id}', () => {
    const custom: PersistedListDefinition = {
      id: 99,
      name: 'Custom',
      sortOrder: 0,
      pinnedToDashboard: true,
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
    const todayList = lists.find((l) => l.id === 1)!
    const deadlines = lists.find((l) => l.id === 3)!
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
    const todayList = lists.find((l) => l.id === 1)!
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

describe('interpretMembership — today with warningWindowDays override', () => {
  it('shorter window (1 day) excludes a deadline 2 days out', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 2 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'today', warningWindowDays: 1 }, t, makeCtx())).toBe(false)
  })

  it('longer window (7 days) includes a deadline 5 days out', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 5 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'today', warningWindowDays: 7 }, t, makeCtx())).toBe(true)
  })

  it('omitting warningWindowDays falls back to default (3)', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 3 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'today' }, t, makeCtx())).toBe(true)
    const t2 = makeTodo({ id: 2, dueDate: new Date(today.getTime() + 4 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'today' }, t2, makeCtx())).toBe(false)
  })
})

describe('interpretMembership — upcoming/today window coupling', () => {
  it('upcoming exclusion uses the same warningWindowDays as today', () => {
    // Task 5 days out: in today when window=7, so must be excluded from upcoming with matching window.
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 5 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'today', warningWindowDays: 7 }, t, makeCtx())).toBe(true)
    expect(interpretMembership({ kind: 'upcoming', warningWindowDays: 7 }, t, makeCtx())).toBe(false)
  })

  it('short-window upcoming still excludes same task from today bucket', () => {
    // Task 2 days out: IN today when window=3 (default), so NOT in upcoming.
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 2 * MS_PER_DAY) })
    expect(interpretMembership({ kind: 'upcoming' }, t, makeCtx())).toBe(false)
    // Narrow window to 1 → task no longer in today → should appear in upcoming.
    expect(interpretMembership({ kind: 'upcoming', warningWindowDays: 1 }, t, makeCtx())).toBe(true)
  })
})

describe('interpretMembership — custom', () => {
  const PREDICATE_ALWAYS = {
    showCompleted: true,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs' as const,
    tagIds: null,
    orgIds: null,
    orgFilterMode: 'include-people' as const,
    statusIds: null,
    searchText: '',
    dateField: 'date' as const,
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
  }

  it('delegates to ctx.evalPredicate', () => {
    const t = makeTodo({ id: 1 })
    const ctx = makeCtx({
      evalPredicate: (_p, todo) => todo.id === 1,
    })
    expect(interpretMembership({ kind: 'custom', predicate: PREDICATE_ALWAYS }, t, ctx)).toBe(true)

    const other = makeTodo({ id: 2 })
    expect(interpretMembership({ kind: 'custom', predicate: PREDICATE_ALWAYS }, other, ctx)).toBe(false)
  })

  it('without ctx.evalPredicate, matches zero todos', () => {
    const t = makeTodo({ id: 1 })
    const ctx = makeCtx() // no evalPredicate
    expect(interpretMembership({ kind: 'custom', predicate: PREDICATE_ALWAYS }, t, ctx)).toBe(false)
  })
})

describe('interpretSort — sortBy', () => {
  it('sortBy=date sorts chronologically, earliest first', () => {
    const early = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() - 1 * MS_PER_DAY) },
    })
    const late = makeTodo({
      id: 2,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() + 5 * MS_PER_DAY) },
    })
    // Use a custom predicate membership that accepts both todos so the sort
    // behavior is isolated from the today/upcoming filter.
    const allPredicate = {
      showCompleted: true, showHiddenStatuses: true,
      personIds: null, personFilterMode: 'include-orgs' as const,
      tagIds: null, orgIds: null, orgFilterMode: 'include-people' as const,
      statusIds: null, searchText: '', dateField: 'date' as const,
      dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false,
      hasScheduled: null, hasDeadline: null,
    }
    const def: PersistedListDefinition = {
      id: 42,
      name: 'By date',
      sortOrder: 0,
      pinnedToDashboard: false,
      membership: { kind: 'custom', predicate: allPredicate },
      sort: { kind: 'sortBy', by: 'date' },
      grouping: { kind: 'none' },
    }
    const lists = buildDashboardLists(
      [def],
      [late, early],
      makeCtx({ evalPredicate: () => true }),
    )
    expect(lists[0].todos.map((t) => t.id)).toEqual([1, 2])
  })

  it('sortBy=deadline sorts by dueDate only', () => {
    const a = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 5 * MS_PER_DAY) })
    const b = makeTodo({ id: 2, dueDate: new Date(today.getTime() + 1 * MS_PER_DAY) })
    const def: PersistedListDefinition = {
      id: 43,
      name: 'Deadline-asc',
      sortOrder: 0,
      pinnedToDashboard: false,
      membership: { kind: 'deadlines' },
      sort: { kind: 'sortBy', by: 'deadline' },
      grouping: { kind: 'none' },
    }
    const lists = buildDashboardLists([def], [a, b], makeCtx())
    expect(lists[0].todos.map((t) => t.id)).toEqual([2, 1])
  })

  it('sortBy=people falls back to sortOrder (categorical ambiguity)', () => {
    const a = makeTodo({ id: 1, sortOrder: 200 })
    const b = makeTodo({ id: 2, sortOrder: 100 })
    const def: PersistedListDefinition = {
      id: 44,
      name: 'By people',
      sortOrder: 0,
      pinnedToDashboard: false,
      membership: { kind: 'someday' },
      sort: { kind: 'sortBy', by: 'people' },
      grouping: { kind: 'none' },
    }
    const lists = buildDashboardLists([def], [a, b], makeCtx())
    expect(lists[0].todos.map((t) => t.id)).toEqual([2, 1])
  })
})

describe('interpretGrouping — by-sortBy', () => {
  it('by-sortBy with sortBy=date reuses relative-effective buckets', () => {
    const anchor = startOfDay(new Date('2026-04-15T00:00:00'))
    const tomorrow = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(anchor.getTime() + 1 * MS_PER_DAY) },
    })
    const def: PersistedListDefinition = {
      id: 50,
      name: 'By date',
      sortOrder: 0,
      pinnedToDashboard: false,
      membership: { kind: 'upcoming' },
      sort: { kind: 'sortBy', by: 'date' },
      grouping: { kind: 'by-sortBy' },
    }
    const lists = buildDashboardLists([def], [tomorrow], makeCtx({ today: anchor }))
    expect(lists[0].groups?.[0].key).toBe('tomorrow')
  })

  it('by-sortBy with sortBy=deadline reuses relative-deadline buckets', () => {
    const overdue = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 5 * MS_PER_DAY) })
    const def: PersistedListDefinition = {
      id: 51,
      name: 'By deadline',
      sortOrder: 0,
      pinnedToDashboard: false,
      membership: { kind: 'deadlines' },
      sort: { kind: 'sortBy', by: 'deadline' },
      grouping: { kind: 'by-sortBy' },
    }
    const lists = buildDashboardLists([def], [overdue], makeCtx())
    expect(lists[0].groups?.[0].key).toBe('overdue')
  })

  it('by-sortBy with categorical sortBy returns undefined (not yet implemented)', () => {
    const t = makeTodo({ id: 1 })
    const def: PersistedListDefinition = {
      id: 52,
      name: 'By tag',
      sortOrder: 0,
      pinnedToDashboard: false,
      membership: { kind: 'someday' },
      sort: { kind: 'sortBy', by: 'tag' },
      grouping: { kind: 'by-sortBy' },
    }
    const lists = buildDashboardLists([def], [t], makeCtx())
    expect(lists[0].groups).toBeUndefined()
  })

  it('by-sortBy without a sortBy sort kind returns undefined', () => {
    const t = makeTodo({ id: 1 })
    const def: PersistedListDefinition = {
      id: 53,
      name: 'Mismatched',
      sortOrder: 0,
      pinnedToDashboard: false,
      membership: { kind: 'someday' },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'by-sortBy' },
    }
    const lists = buildDashboardLists([def], [t], makeCtx())
    expect(lists[0].groups).toBeUndefined()
  })
})
