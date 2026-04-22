import { describe, it, expect } from 'vitest'
import {
  buildDashboardLists,
  interpretMembership,
  type DashboardListsContext,
} from '../../services/dashboard-lists'
import { resolveFuzzy } from '../../utils/effective-date'
import { MS_PER_DAY, startOfDay } from '../../utils/date'
import type { PersistedTodoItem, TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'

const today = startOfDay(new Date('2026-04-13T12:00:00'))

const hiddenStatusId = 101

function emptyPredicate(): TodoPredicate {
  return {
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
  }
}

/**
 * Default: match every todo (grouping/sort tests don't care about membership).
 * Individual tests that need a custom predicate pass one in makeCtx overrides.
 */
function makeCtx(overrides: Partial<DashboardListsContext> = {}): DashboardListsContext {
  return {
    today,
    evalPredicate: () => true,
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

function customDef(overrides: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id: 1,
    name: 'List',
    sortOrder: 0,
    pinnedToDashboard: true,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: { kind: 'effective-date-asc' },
    grouping: { kind: 'none' },
    ...overrides,
  }
}

const DATE_GROUPED_DEF = customDef({
  id: 2,
  name: 'Date grouped',
  grouping: { kind: 'relative-effective' },
})
const DEADLINE_GROUPED_DEF = customDef({
  id: 3,
  name: 'Deadline grouped',
  sort: { kind: 'deadline-asc' },
  grouping: { kind: 'relative-deadline' },
})

describe('buildDashboardLists', () => {
  it('returns empty array when no definitions', () => {
    expect(buildDashboardLists([], [makeTodo({ id: 1 })], makeCtx())).toEqual([])
  })

  it('renders definitions in sortOrder', () => {
    const defs = [
      customDef({ id: 1, name: 'A', sortOrder: 0 }),
      customDef({ id: 2, name: 'B', sortOrder: 1 }),
      customDef({ id: 3, name: 'C', sortOrder: 2 }),
    ]
    const lists = buildDashboardLists(defs, [], makeCtx())
    expect(lists.map((l) => l.id)).toEqual([1, 2, 3])
    expect(lists.map((l) => l.label)).toEqual(['A', 'B', 'C'])
  })

  it('keys every row by def-{id}', () => {
    const lists = buildDashboardLists([customDef({ id: 99 })], [], makeCtx())
    expect(lists[0]?.key).toBe('def-99')
  })
})

describe('interpretMembership — custom', () => {
  it('delegates to ctx.evalPredicate — evaluator is authoritative for all gates including showCompleted/showHiddenStatuses', () => {
    const t = makeTodo({ id: 1 })
    const ctx = makeCtx({
      evalPredicate: (_p, todo) => todo.id === 1,
    })
    expect(interpretMembership({ kind: 'custom', predicate: emptyPredicate() }, t, ctx)).toBe(true)

    const other = makeTodo({ id: 2 })
    expect(interpretMembership({ kind: 'custom', predicate: emptyPredicate() }, other, ctx)).toBe(false)
  })

  it('without ctx.evalPredicate, matches zero todos', () => {
    const t = makeTodo({ id: 1 })
    const ctx: DashboardListsContext = { today }
    expect(interpretMembership({ kind: 'custom', predicate: emptyPredicate() }, t, ctx)).toBe(false)
  })
})

describe('buildDashboardLists — sort', () => {
  it('sorts by effectiveDate ascending (earlier first)', () => {
    const earlier = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() - 2 * MS_PER_DAY) },
    })
    const later = makeTodo({
      id: 2,
      scheduledDate: { kind: 'date', value: today },
    })
    const lists = buildDashboardLists([customDef()], [later, earlier], makeCtx())
    expect(lists[0].todos.map((t) => t.id)).toEqual([1, 2])
  })

  it('sorts by scheduled-asc ascending, nulls last', () => {
    const earlier = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() + 1 * MS_PER_DAY) },
      dueDate: new Date(today.getTime() + 30 * MS_PER_DAY),
    })
    const later = makeTodo({
      id: 2,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() + 5 * MS_PER_DAY) },
    })
    const noScheduled = makeTodo({
      id: 3,
      dueDate: new Date(today.getTime() + 1 * MS_PER_DAY),
    })
    const def = customDef({ sort: { kind: 'scheduled-asc' } })
    const lists = buildDashboardLists([def], [noScheduled, later, earlier], makeCtx())
    expect(lists[0].todos.map((t) => t.id)).toEqual([1, 2, 3])
  })
})

describe('buildDashboardLists — grouping', () => {
  it('drops empty groups', () => {
    const nextWeek = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(today.getTime() + 10 * MS_PER_DAY) },
    })
    const lists = buildDashboardLists([DATE_GROUPED_DEF], [nextWeek], makeCtx())
    const list = lists[0]
    expect(list.groups).toBeDefined()
    expect(list.groups!.length).toBeGreaterThan(0)
    for (const g of list.groups!) {
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
      [DATE_GROUPED_DEF],
      [tomorrow, thisWeek, nextWeek, laterMonth, nextMonth, beyond],
      makeCtx({ today: anchor }),
    )
    const grouped = lists[0]
    expect(grouped.groups!.map((g) => g.key)).toEqual([
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
    const lists = buildDashboardLists([customDef()], [t], makeCtx())
    expect(lists[0].groups).toBeUndefined()
  })

  it('deadline bucketing puts overdue first', () => {
    const overdue = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 5 * MS_PER_DAY) })
    const lists = buildDashboardLists([DEADLINE_GROUPED_DEF], [overdue], makeCtx())
    expect(lists[0].groups![0].key).toBe('overdue')
  })
})

describe('buildDashboardLists — no list caps', () => {
  it('returns every matching task (no TOP_N)', () => {
    const future = new Date(today.getTime() + 30 * MS_PER_DAY)
    const todos = Array.from({ length: 47 }, (_, i) =>
      makeTodo({ id: i + 1, scheduledDate: { kind: 'date', value: future } }),
    )
    const lists = buildDashboardLists([customDef()], todos, makeCtx())
    expect(lists[0].todos).toHaveLength(47)
  })
})

describe('buildDashboardLists — visibility via def predicate', () => {
  // Realistic evalPredicate: the def's predicate controls completed / hidden-status visibility.
  const hiddenStatusIdSet = new Set([hiddenStatusId])
  const evalByPredicate = (p: TodoPredicate, t: PersistedTodoItem) => {
    if (t.isCompleted && !p.showCompleted) return false
    if (t.statusId != null && hiddenStatusIdSet.has(t.statusId) && !p.showHiddenStatuses) return false
    return true
  }

  it('hideByDefault status excluded when def predicate hides them', () => {
    const t = makeTodo({ id: 1, statusId: hiddenStatusId })
    const lists = buildDashboardLists([customDef()], [t], makeCtx({ evalPredicate: evalByPredicate }))
    expect(lists[0].todos).toHaveLength(0)
  })

  it('hideByDefault status included when def predicate shows them', () => {
    const t = makeTodo({ id: 1, statusId: hiddenStatusId })
    const def = customDef({ membership: { kind: 'custom', predicate: { ...emptyPredicate(), showHiddenStatuses: true } } })
    const lists = buildDashboardLists([def], [t], makeCtx({ evalPredicate: evalByPredicate }))
    expect(lists[0].todos).toHaveLength(1)
  })

  it('completed tasks excluded when def predicate hides them', () => {
    const t = makeTodo({ id: 1, isCompleted: true })
    const lists = buildDashboardLists([customDef()], [t], makeCtx({ evalPredicate: evalByPredicate }))
    expect(lists[0].todos).toHaveLength(0)
  })

  it('completed tasks included when def predicate shows them', () => {
    const t = makeTodo({ id: 1, isCompleted: true })
    const def = customDef({ membership: { kind: 'custom', predicate: { ...emptyPredicate(), showCompleted: true } } })
    const lists = buildDashboardLists([def], [t], makeCtx({ evalPredicate: evalByPredicate }))
    expect(lists[0].todos).toHaveLength(1)
  })
})

describe('week boundary parity with resolveFuzzy', () => {
  it('bucketByEffective thisWeekEnd matches resolveFuzzy("this-week")', () => {
    const anchor = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
    // A task at this-week end should land in 'this-week' bucket, not 'next-week'.
    const thisWeekEnd = resolveFuzzy('this-week', anchor)
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: thisWeekEnd } })
    const lists = buildDashboardLists([DATE_GROUPED_DEF], [t], makeCtx({ today: anchor }))
    const grouped = lists[0]
    const thisWeekGroup = grouped.groups!.find((g) => g.key === 'this-week')
    expect(thisWeekGroup?.todos.map((x) => x.id)).toContain(1)
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
    const def = customDef({
      sort: { kind: 'sortBy', by: 'date' },
    })
    const lists = buildDashboardLists(
      [def],
      [late, early],
      makeCtx(),
    )
    expect(lists[0].todos.map((t) => t.id)).toEqual([1, 2])
  })

  it('sortBy=deadline sorts by dueDate only', () => {
    const a = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 5 * MS_PER_DAY) })
    const b = makeTodo({ id: 2, dueDate: new Date(today.getTime() + 1 * MS_PER_DAY) })
    const def = customDef({
      sort: { kind: 'sortBy', by: 'deadline' },
    })
    const lists = buildDashboardLists([def], [a, b], makeCtx())
    expect(lists[0].todos.map((t) => t.id)).toEqual([2, 1])
  })

  it('sortBy=people falls back to sortOrder (categorical ambiguity)', () => {
    const a = makeTodo({ id: 1, sortOrder: 200 })
    const b = makeTodo({ id: 2, sortOrder: 100 })
    const def = customDef({
      sort: { kind: 'sortBy', by: 'people' },
    })
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
    const def = customDef({
      sort: { kind: 'sortBy', by: 'date' },
      grouping: { kind: 'by-sortBy' },
    })
    const lists = buildDashboardLists([def], [tomorrow], makeCtx({ today: anchor }))
    expect(lists[0].groups?.[0].key).toBe('tomorrow')
  })

  it('by-sortBy with sortBy=deadline reuses relative-deadline buckets', () => {
    const overdue = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 5 * MS_PER_DAY) })
    const def = customDef({
      sort: { kind: 'sortBy', by: 'deadline' },
      grouping: { kind: 'by-sortBy' },
    })
    const lists = buildDashboardLists([def], [overdue], makeCtx())
    expect(lists[0].groups?.[0].key).toBe('overdue')
  })

  it('by-sortBy with categorical sortBy returns undefined (not yet implemented)', () => {
    const t = makeTodo({ id: 1 })
    const def = customDef({
      sort: { kind: 'sortBy', by: 'people' },
      grouping: { kind: 'by-sortBy' },
    })
    const lists = buildDashboardLists([def], [t], makeCtx())
    expect(lists[0].groups).toBeUndefined()
  })

  it('by-sortBy without a sortBy sort kind returns undefined', () => {
    const t = makeTodo({ id: 1 })
    const def = customDef({
      sort: { kind: 'sort-order' },
      grouping: { kind: 'by-sortBy' },
    })
    const lists = buildDashboardLists([def], [t], makeCtx())
    expect(lists[0].groups).toBeUndefined()
  })
})
