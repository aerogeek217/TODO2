import { describe, it, expect } from 'vitest'
import {
  applyRuntimeFilter,
  buildDashboardLists,
  interpretMembership,
  type DashboardListsContext,
} from '../../services/dashboard-lists'
import { resolveFuzzy } from '../../utils/effective-date'
import { MS_PER_DAY, startOfDay } from '../../utils/date'
import type { PersistedTodoItem, Tag, TodoPredicate } from '../../models'
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
    tags: null,
  }
}

/**
 * Default: match every todo (grouping/sort tests don't care about membership).
 * Individual tests that need a custom predicate pass one in makeCtx overrides.
 */
function makeCtx(overrides: Partial<DashboardListsContext> = {}): DashboardListsContext {
  return {
    today,
    weekStartsOn: 1,
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
    favorited: false,
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

describe('buildDashboardLists — predicate tags clause', () => {
  // End-to-end: the same evalPredicate used by HorizonsSlotContent + ListDefinitionBody,
  // wired to the canonical matchesFilter. A custom list with `tags: [<id>]`
  // should include only todos whose assignment map contains the id via OR.
  // Predicate tag ids are into the registry; assigned-tag resolution lives at
  // the caller, so tests pass a pre-built `Map<todoId, tagId[]>` in as context.
  const URGENT_ID = 10
  const SOON_ID = 20

  const evalViaMatches = async (assigned: Map<number, number[]>) => {
    const { predicateToCriteria, matchesFilter } = await import('../../stores/filter-store')
    return (p: TodoPredicate, t: PersistedTodoItem) =>
      matchesFilter(
        predicateToCriteria(p), t,
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined,
        assigned.get(t.id) ?? [],
      )
  }

  it('includes todos whose assignment map overlaps the predicate tags clause (OR)', async () => {
    const assigned = new Map<number, number[]>([
      [1, [URGENT_ID]],
      [2, [SOON_ID, URGENT_ID]],
      [3, [SOON_ID]],
      // todo 4 unassigned
    ])
    const evalPredicate = await evalViaMatches(assigned)
    const def = customDef({
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), tags: [URGENT_ID] } },
    })
    const todos = [
      makeTodo({ id: 1 }),
      makeTodo({ id: 2 }),
      makeTodo({ id: 3 }),
      makeTodo({ id: 4 }),
    ]
    const lists = buildDashboardLists([def], todos, makeCtx({ evalPredicate }))
    expect(lists[0].todos.map(t => t.id).sort()).toEqual([1, 2])
  })

  it('excludes unassigned todos when the tags clause is non-empty', async () => {
    const assigned = new Map<number, number[]>([
      [3, [SOON_ID]],
      // todos 1 + 2 have no assignments
    ])
    const evalPredicate = await evalViaMatches(assigned)
    const def = customDef({
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), tags: [SOON_ID] } },
    })
    const todos = [
      makeTodo({ id: 1 }),
      makeTodo({ id: 2 }),
      makeTodo({ id: 3 }),
    ]
    const lists = buildDashboardLists([def], todos, makeCtx({ evalPredicate }))
    expect(lists[0].todos.map(t => t.id)).toEqual([3])
  })

  it('null (missing) tags clause is a no-op — all todos match the gate', async () => {
    const assigned = new Map<number, number[]>([
      [2, [URGENT_ID]],
    ])
    const evalPredicate = await evalViaMatches(assigned)
    const def = customDef() // emptyPredicate() has tags: null
    const todos = [
      makeTodo({ id: 1 }),
      makeTodo({ id: 2 }),
    ]
    const lists = buildDashboardLists([def], todos, makeCtx({ evalPredicate }))
    expect(lists[0].todos.map(t => t.id).sort()).toEqual([1, 2])
  })
})

describe('buildDashboardLists — runtime filter', () => {
  // Runtime filter merges a caller-supplied id into the def's predicate right
  // before membership evaluation. We verify three branches: unset, picked +
  // matching, picked + non-matching; and that `applyRuntimeFilter` rewrites
  // the predicate field for each supported entity.

  it('returns an empty list with runtimeFilterUnset=true when no pick supplied', () => {
    const def = customDef({
      id: 7,
      runtimeFilter: { field: 'person' },
    })
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 })]
    const [list] = buildDashboardLists([def], todos, makeCtx())
    expect(list.runtimeFilterUnset).toBe(true)
    expect(list.todos).toEqual([])
  })

  it('merges the pick into the predicate and filters via evalPredicate', () => {
    const def = customDef({
      id: 7,
      runtimeFilter: { field: 'person' },
    })
    const calls: TodoPredicate[] = []
    const evalPredicate = (p: TodoPredicate, t: PersistedTodoItem) => {
      calls.push(p)
      // Stand-in: the test evaluator treats predicate.personIds as ground truth.
      if (!p.personIds) return true
      return p.personIds.includes(t.id)
    }
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const ctx = makeCtx({
      evalPredicate,
      runtimeFilterValues: new Map([[7, [2]]]),
    })
    const [list] = buildDashboardLists([def], todos, ctx)
    expect(list.runtimeFilterUnset).toBeUndefined()
    expect(list.todos.map((t) => t.id)).toEqual([2])
    // All eval calls saw the rewritten predicate with personIds=[2]
    expect(calls.every((p) => p.personIds?.length === 1 && p.personIds[0] === 2)).toBe(true)
  })

  it('OR-combines multi-value picks before membership eval', () => {
    const def = customDef({ id: 7, runtimeFilter: { field: 'person' } })
    const evalPredicate = (p: TodoPredicate, t: PersistedTodoItem) => {
      if (!p.personIds) return true
      return p.personIds.includes(t.id)
    }
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const ctx = makeCtx({
      evalPredicate,
      runtimeFilterValues: new Map([[7, [1, 3]]]),
    })
    const [list] = buildDashboardLists([def], todos, ctx)
    expect(list.todos.map((t) => t.id).sort()).toEqual([1, 3])
  })

  it('treats an empty pick array as a no-op (predicate passes through)', () => {
    const def = customDef({ id: 7, runtimeFilter: { field: 'person' } })
    // evalPredicate returns true unconditionally; if applyRuntimeFilter wrote
    // `personIds: []` into the predicate, a strict evaluator would short-
    // circuit to "match nothing". The helper must instead pass the predicate
    // through unchanged so all 3 todos remain.
    const evalPredicate = (p: TodoPredicate) => {
      // If the helper had written an empty array, p.personIds would be `[]`;
      // we expect it to remain `null` here so no narrowing happens.
      expect(p.personIds).toBeNull()
      return true
    }
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const ctx = makeCtx({
      evalPredicate,
      runtimeFilterValues: new Map([[7, []]]),
    })
    const [list] = buildDashboardLists([def], todos, ctx)
    expect(list.runtimeFilterUnset).toBeUndefined()
    expect(list.todos.map((t) => t.id)).toEqual([1, 2, 3])
  })

  it('leaves other batched defs untouched by the runtime pick', () => {
    const withRt = customDef({ id: 1, name: 'rt', runtimeFilter: { field: 'project' } })
    const plain = customDef({ id: 2, name: 'plain' })
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 })]
    const lists = buildDashboardLists([withRt, plain], todos, makeCtx({
      runtimeFilterValues: new Map([[1, [9]]]),
    }))
    // rt applies pick; plain is unaffected and matches all (evalPredicate default)
    expect(lists.find((l) => l.id === 1)?.runtimeFilterUnset).toBeUndefined()
    expect(lists.find((l) => l.id === 2)?.todos.map((t) => t.id).sort()).toEqual([1, 2])
  })

  it('applyRuntimeFilter rewrites the appropriate id list for each field', () => {
    const base = emptyPredicate()
    expect(applyRuntimeFilter(base, { field: 'person' }, [5]).personIds).toEqual([5])
    expect(applyRuntimeFilter(base, { field: 'org' }, [6]).orgIds).toEqual([6])
    expect(applyRuntimeFilter(base, { field: 'project' }, [7]).projectIds).toEqual([7])
    expect(applyRuntimeFilter(base, { field: 'status' }, [8]).statusIds).toEqual([8])
    expect(applyRuntimeFilter(base, { field: 'tag' }, [9]).tags).toEqual([9])
  })

  it('applyRuntimeFilter passes multi-value arrays through to the predicate', () => {
    const base = emptyPredicate()
    expect(applyRuntimeFilter(base, { field: 'person' }, [1, 2, 3]).personIds).toEqual([1, 2, 3])
    expect(applyRuntimeFilter(base, { field: 'tag' }, [4, 5]).tags).toEqual([4, 5])
  })

  it('applyRuntimeFilter is a no-op when values is empty (predicate unchanged)', () => {
    const base: TodoPredicate = { ...emptyPredicate(), personIds: [1, 2, 3] }
    const result = applyRuntimeFilter(base, { field: 'person' }, [])
    // Returned predicate has the same personIds — helper did NOT rewrite to
    // `[]` (which would short-circuit a strict evaluator to "match nothing").
    expect(result).toBe(base)
    expect(result.personIds).toEqual([1, 2, 3])
  })

  it('applyRuntimeFilter overwrites any prior id filter on the same field', () => {
    const base: TodoPredicate = { ...emptyPredicate(), personIds: [1, 2, 3] }
    expect(applyRuntimeFilter(base, { field: 'person' }, [9]).personIds).toEqual([9])
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
    const ctx: DashboardListsContext = { today, weekStartsOn: 1 }
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

  it('deadline bucketing places todos without a deadline into a trailing noDeadline bucket', () => {
    const withDeadline = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 2 * MS_PER_DAY) })
    const withoutDeadline = makeTodo({ id: 2 })
    const lists = buildDashboardLists(
      [DEADLINE_GROUPED_DEF],
      [withDeadline, withoutDeadline],
      makeCtx(),
    )
    const groups = lists[0].groups!
    const noDeadline = groups.find((g) => g.key === 'no-deadline')
    expect(noDeadline).toBeDefined()
    expect(noDeadline!.label).toBe('No deadline')
    expect(noDeadline!.todos.map((t) => t.id)).toEqual([2])
    expect(groups[groups.length - 1].key).toBe('no-deadline')
  })

  it('deadline bucketing omits the noDeadline bucket when every todo has a deadline', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 1 * MS_PER_DAY) })
    const lists = buildDashboardLists([DEADLINE_GROUPED_DEF], [t], makeCtx())
    expect(lists[0].groups!.map((g) => g.key)).not.toContain('no-deadline')
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
  it('bucketByEffective thisWeekEnd matches resolveFuzzy("this-week") for Mon-first', () => {
    const anchor = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
    // A task at this-week end should land in 'this-week' bucket, not 'next-week'.
    const thisWeekEnd = resolveFuzzy('this-week', anchor, 1)
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: thisWeekEnd } })
    const lists = buildDashboardLists([DATE_GROUPED_DEF], [t], makeCtx({ today: anchor, weekStartsOn: 1 }))
    const grouped = lists[0]
    const thisWeekGroup = grouped.groups!.find((g) => g.key === 'this-week')
    expect(thisWeekGroup?.todos.map((x) => x.id)).toContain(1)
  })

  it('bucketByEffective thisWeekEnd matches resolveFuzzy("this-week") for Sun-first', () => {
    const anchor = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
    const thisWeekEndSun = resolveFuzzy('this-week', anchor, 0) // Saturday for Sun-first
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: thisWeekEndSun } })
    const lists = buildDashboardLists([DATE_GROUPED_DEF], [t], makeCtx({ today: anchor, weekStartsOn: 0 }))
    const grouped = lists[0]
    const thisWeekGroup = grouped.groups!.find((g) => g.key === 'this-week')
    expect(thisWeekGroup?.todos.map((x) => x.id)).toContain(1)
  })

  it('Sunday-first vs Monday-first place a Saturday differently', () => {
    // 2026-04-15 is Wed. With Mon-first (1), Saturday 4/18 lands in 'this-week'
    // (week ends Sunday 4/19). With Sun-first (0), Saturday 4/18 lands in
    // 'this-week' too (week ends Saturday 4/18). The divergence shows for
    // Sunday 4/19: Mon-first puts it in 'this-week' (last day); Sun-first
    // pushes it to 'next-week' (already past Saturday end).
    const anchor = startOfDay(new Date('2026-04-15T00:00:00'))
    const sunday = startOfDay(new Date(anchor.getTime() + 4 * MS_PER_DAY)) // 2026-04-19
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: sunday } })

    const monFirst = buildDashboardLists([DATE_GROUPED_DEF], [t], makeCtx({ today: anchor, weekStartsOn: 1 }))
    expect(monFirst[0].groups!.find((g) => g.key === 'this-week')?.todos.map((x) => x.id)).toContain(1)

    const sunFirst = buildDashboardLists([DATE_GROUPED_DEF], [t], makeCtx({ today: anchor, weekStartsOn: 0 }))
    expect(sunFirst[0].groups!.find((g) => g.key === 'next-week')?.todos.map((x) => x.id)).toContain(1)
    // 'this-week' bucket is dropped when empty; find returns undefined.
    expect(sunFirst[0].groups!.find((g) => g.key === 'this-week')).toBeUndefined()
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

  it('by-sortBy with categorical sortBy buckets via registry + assigned map', () => {
    const ALICE: import('../../models').Person = { id: 1, name: 'Alice', initials: 'A' }
    const BOB: import('../../models').Person = { id: 2, name: 'Bob', initials: 'B' }
    const t1 = makeTodo({ id: 101 })
    const t2 = makeTodo({ id: 102 })
    const t3 = makeTodo({ id: 103 })
    const assignedPeopleMap = new Map<number, import('../../models').Person[]>([
      [101, [ALICE]],
      [102, [BOB, ALICE]],
      // 103 unassigned → "Unassigned"
    ])
    const def = customDef({
      sort: { kind: 'sortBy', by: 'people' },
      grouping: { kind: 'by-sortBy' },
    })
    const lists = buildDashboardLists([def], [t1, t2, t3], makeCtx({
      people: [ALICE, BOB],
      assignedPeopleMap,
    }))
    const groups = lists[0].groups!
    expect(groups.map((g) => g.key)).toEqual(['person-1', 'person-2', 'unassigned'])
    expect(groups[0].todos.map((t) => t.id).sort()).toEqual([101, 102])
    expect(groups[1].todos.map((t) => t.id)).toEqual([102])
    expect(groups[2].todos.map((t) => t.id)).toEqual([103])
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

describe('interpretGrouping — by-tag', () => {
  const URGENT: Tag = { id: 10, name: 'urgent', color: '#f00' }
  const WORK: Tag = { id: 20, name: 'work', color: '#0f0' }
  const ALPHA: Tag = { id: 30, name: 'alpha', color: '#00f' }
  const MU: Tag = { id: 40, name: 'mu', color: '#ff0' }
  const ZETA: Tag = { id: 50, name: 'zeta', color: '#0ff' }

  it('explodes N-tag todos into N buckets (many-to-many) via assignedTagsMap', () => {
    const a = makeTodo({ id: 1 })
    const b = makeTodo({ id: 2 })
    const assignedTagsMap = new Map<number, Tag[]>([
      [1, [URGENT, WORK]],
      [2, [URGENT]],
    ])
    const def = customDef({ grouping: { kind: 'by-tag' } })
    const lists = buildDashboardLists([def], [a, b], makeCtx({ assignedTagsMap }))
    const groups = lists[0].groups!
    expect(groups.map((g) => g.key)).toEqual(['tag-10', 'tag-20'])
    expect(groups.map((g) => g.label)).toEqual(['#urgent', '#work'])
    expect(groups[0].todos.map((t) => t.id).sort()).toEqual([1, 2])
    expect(groups[1].todos.map((t) => t.id)).toEqual([1])
  })

  it('routes untagged todos into a trailing "No tag" bucket', () => {
    const tagged = makeTodo({ id: 1 })
    const untagged = makeTodo({ id: 2 })
    const assignedTagsMap = new Map<number, Tag[]>([
      [1, [URGENT]],
      // 2 has no entry
    ])
    const def = customDef({ grouping: { kind: 'by-tag' } })
    const lists = buildDashboardLists([def], [tagged, untagged], makeCtx({ assignedTagsMap }))
    const groups = lists[0].groups!
    expect(groups.map((g) => g.key)).toEqual(['tag-10', 'no-tag'])
    expect(groups[1].label).toBe('No tag')
    expect(groups[1].todos.map((t) => t.id)).toEqual([2])
  })

  it('sorts tag buckets alphabetically by registry name', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const assignedTagsMap = new Map<number, Tag[]>([
      [1, [ZETA]],
      [2, [ALPHA]],
      [3, [MU]],
    ])
    const def = customDef({ grouping: { kind: 'by-tag' } })
    const lists = buildDashboardLists([def], todos, makeCtx({ assignedTagsMap }))
    expect(lists[0].groups!.map((g) => g.key)).toEqual(['tag-30', 'tag-40', 'tag-50'])
    expect(lists[0].groups!.map((g) => g.label)).toEqual(['#alpha', '#mu', '#zeta'])
  })

  it('returns an empty list (not undefined) when no todos match', () => {
    const def = customDef({ grouping: { kind: 'by-tag' } })
    const lists = buildDashboardLists([def], [], makeCtx())
    expect(lists[0].groups).toEqual([])
  })

  it('without an assignedTagsMap, every todo lands in the "No tag" bucket', () => {
    const a = makeTodo({ id: 1 })
    const def = customDef({ grouping: { kind: 'by-tag' } })
    const lists = buildDashboardLists([def], [a], makeCtx())
    expect(lists[0].groups).toEqual([
      { key: 'no-tag', label: 'No tag', todos: [a] },
    ])
  })
})
