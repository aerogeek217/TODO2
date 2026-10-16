import { describe, it, expect } from 'vitest'
import {
  applyRuntimeFilter,
  buildList,
  matchesMembership,
  type ListBuildContext,
} from '../../services/build-list'
import { MS_PER_DAY, startOfDay } from '../../utils/date'
import type { Person, PersistedTodoItem, Tag, TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { emptyPredicate } from '../../models'
import { makeTodo, matchesFilterNow as matchesFilter } from '../helpers'

const today = startOfDay(new Date('2026-04-13T12:00:00'))

/**
 * Default: match every todo (grouping/sort tests don't care about membership).
 * Individual tests that need a custom predicate pass one in makeCtx overrides.
 */
function makeCtx(overrides: Partial<ListBuildContext> = {}): ListBuildContext {
  return {
    today,
    weekStartsOn: 1,
    evalPredicate: () => true,
    ...overrides,
  }
}

function customDef(overrides: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id: 1,
    name: 'List',
    sortOrder: 0,
    pinnedToDashboard: true,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: 'deadline',
    grouping: 'none',
    ...overrides,
  }
}

const FOLLOWUP_GROUPED_DEF = customDef({
  id: 2,
  name: 'Follow-up grouped',
  sort: 'followup',
  grouping: 'followup',
})
const DEADLINE_GROUPED_DEF = customDef({
  id: 3,
  name: 'Deadline grouped',
  sort: 'deadline',
  grouping: 'deadline',
})

describe('buildList', () => {
  it('labels and keys the list by its definition', () => {
    const list = buildList(customDef({ id: 99, name: 'Mine' }), [], makeCtx())
    expect(list).toMatchObject({ id: 99, key: 'def-99', label: 'Mine', todos: [], sections: [] })
  })
})

describe('buildList — predicate tags clause', () => {
  // End-to-end: the same evalPredicate used by ListDefinitionBody,
  // wired to the canonical matchesFilter. A custom list with `tags: [<id>]`
  // should include only todos whose assignment map contains the id via OR.
  // Predicate tag ids are into the registry; assigned-tag resolution lives at
  // the caller, so tests pass a pre-built `Map<todoId, tagId[]>` in as context.
  const URGENT_ID = 10
  const SOON_ID = 20

  const evalViaMatches = async (assigned: Map<number, number[]>) => {
    const { predicateToCriteria } = await import('../../utils/filter-criteria')
    return (p: TodoPredicate, t: PersistedTodoItem) =>
      matchesFilter(
        predicateToCriteria(p), t,
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
    const list = buildList(def, todos, makeCtx({ evalPredicate }))
    expect(list.todos.map(t => t.id).sort()).toEqual([1, 2])
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
    const list = buildList(def, todos, makeCtx({ evalPredicate }))
    expect(list.todos.map(t => t.id)).toEqual([3])
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
    const list = buildList(def, todos, makeCtx({ evalPredicate }))
    expect(list.todos.map(t => t.id).sort()).toEqual([1, 2])
  })
})

describe('buildList — runtime filter', () => {
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
    const list = buildList(def, todos, makeCtx())
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
      runtimeFilterValue: [2],
    })
    const list = buildList(def, todos, ctx)
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
      runtimeFilterValue: [1, 3],
    })
    const list = buildList(def, todos, ctx)
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
      runtimeFilterValue: [],
    })
    const list = buildList(def, todos, ctx)
    expect(list.runtimeFilterUnset).toBeUndefined()
    expect(list.todos.map((t) => t.id)).toEqual([1, 2, 3])
  })

  it('a list without a prompt ignores a pick', () => {
    const plain = customDef({ id: 2, name: 'plain' })
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 })]
    const list = buildList(plain, todos, makeCtx({ runtimeFilterValue: [9] }))
    expect(list.runtimeFilterUnset).toBeUndefined()
    expect(list.todos.map((t) => t.id).sort()).toEqual([1, 2])
  })

  it('applyRuntimeFilter rewrites the appropriate id list for each field', () => {
    const base = emptyPredicate()
    expect(applyRuntimeFilter(base, { field: 'person' }, [5]).personIds).toEqual([5])
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

  it('applyRuntimeFilter on a person pick sets only personIds; other fields pass through', () => {
    const base: TodoPredicate = { ...emptyPredicate(), tags: [4], statusIds: [2] }
    expect(applyRuntimeFilter(base, { field: 'person' }, [5])).toEqual({ ...base, personIds: [5] })
  })

  it('end-to-end: runtime person pick of A keeps only tasks assigned to A', async () => {
    // Wire the canonical matchesFilter as evalPredicate (same shape list
    // widgets use). Picking Alice via a runtime person filter
    // includes her task and excludes both another person's task and an
    // unassigned one.
    const { predicateToCriteria } = await import('../../utils/filter-criteria')
    const ALICE = 1
    const BOB = 2
    const assignedPersonIds = new Map<number, number[]>([
      [10, [ALICE]],
      [11, [BOB]],
      // 12 is unassigned.
    ])
    const evalPredicate = (p: TodoPredicate, t: PersistedTodoItem) =>
      matchesFilter(predicateToCriteria(p), t, assignedPersonIds.get(t.id) ?? [])
    const def = customDef({ id: 50, runtimeFilter: { field: 'person' } })
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 }), makeTodo({ id: 12 })]
    const ctx = makeCtx({
      evalPredicate,
      runtimeFilterValue: [ALICE],
    })
    const list = buildList(def, todos, ctx)
    expect(list.todos.map((t) => t.id)).toEqual([10])
  })
})

describe('matchesMembership — custom', () => {
  it('delegates to the evaluator — it is authoritative for all gates including showCompleted', () => {
    const evalPredicate = (_p: TodoPredicate, todo: PersistedTodoItem) => todo.id === 1
    const membership = { kind: 'custom' as const, predicate: emptyPredicate() }
    expect(matchesMembership(membership, makeTodo({ id: 1 }), evalPredicate)).toBe(true)
    expect(matchesMembership(membership, makeTodo({ id: 2 }), evalPredicate)).toBe(false)
  })
})

describe('buildList — sort', () => {
  it('sorts by due date ascending (earlier first)', () => {
    const earlier = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 2 * MS_PER_DAY) })
    const later = makeTodo({ id: 2, dueDate: today })
    const list = buildList(customDef(), [later, earlier], makeCtx())
    expect(list.todos.map((t) => t.id)).toEqual([1, 2])
  })

  it('sorts by next follow-up ascending, nulls last', () => {
    const earlier = makeTodo({
      id: 1,
      nextFollowupAt: new Date(today.getTime() + 1 * MS_PER_DAY),
      dueDate: new Date(today.getTime() + 30 * MS_PER_DAY),
    })
    const later = makeTodo({ id: 2, nextFollowupAt: new Date(today.getTime() + 5 * MS_PER_DAY) })
    const noFollowup = makeTodo({ id: 3, dueDate: new Date(today.getTime() + 1 * MS_PER_DAY) })
    const def = customDef({ sort: 'followup' })
    const list = buildList(def, [noFollowup, later, earlier], makeCtx())
    expect(list.todos.map((t) => t.id)).toEqual([1, 2, 3])
  })
})

describe('buildList — grouping', () => {
  it('drops empty groups', () => {
    const nextWeek = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 10 * MS_PER_DAY) })
    const list = buildList(DEADLINE_GROUPED_DEF, [nextWeek], makeCtx())
    expect(list.sections).toBeDefined()
    expect(list.sections.length).toBeGreaterThan(0)
    for (const g of list.sections) {
      expect(g.todos.length).toBeGreaterThan(0)
    }
  })

  it('orders due-date sections Overdue → Today → This Week → Later', () => {
    // Wed 2026-04-15: this week ends Sun 04-19.
    const anchor = startOfDay(new Date('2026-04-15T00:00:00'))
    const at = (days: number) => new Date(anchor.getTime() + days * MS_PER_DAY)
    const todos = [
      makeTodo({ id: 1, dueDate: at(-2) }),
      makeTodo({ id: 2, dueDate: at(0) }),
      makeTodo({ id: 3, dueDate: at(3) }),
      makeTodo({ id: 4, dueDate: at(8) }),
      makeTodo({ id: 5, dueDate: at(14) }),
      makeTodo({ id: 6, dueDate: at(35) }),
    ]
    const list = buildList(DEADLINE_GROUPED_DEF, todos, makeCtx({ today: anchor }))
    expect(list.sections.map((g) => [g.key, g.todos.map((t) => t.id)])).toEqual([
      ['overdue', [1]], ['today', [2]], ['week', [3]], ['later', [4, 5, 6]],
    ])
  })

  it('an ungrouped list has one "all" section', () => {
    const t = makeTodo({ id: 1, dueDate: today })
    const list = buildList(customDef(), [t], makeCtx())
    expect(list.sections.map((g) => [g.key, g.todos.map((x) => x.id)])).toEqual([['all', [1]]])
  })

  it('deadline bucketing puts overdue first', () => {
    const overdue = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 5 * MS_PER_DAY) })
    const list = buildList(DEADLINE_GROUPED_DEF, [overdue], makeCtx())
    expect(list.sections[0]!.key).toBe('overdue')
  })

  it('deadline bucketing places todos without a due date into a trailing bucket', () => {
    const withDeadline = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 2 * MS_PER_DAY) })
    const withoutDeadline = makeTodo({ id: 2 })
    const list = buildList(DEADLINE_GROUPED_DEF, [withDeadline, withoutDeadline], makeCtx())
    const groups = list.sections
    const noDeadline = groups.find((g) => g.key === 'none')
    expect(noDeadline).toBeDefined()
    expect(noDeadline!.label).toBe('No Due Date')
    expect(noDeadline!.todos.map((t) => t.id)).toEqual([2])
    expect(groups[groups.length - 1]!.key).toBe('none')
  })

  it('deadline bucketing omits the no-due-date bucket when every todo has one', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 1 * MS_PER_DAY) })
    const list = buildList(DEADLINE_GROUPED_DEF, [t], makeCtx())
    expect(list.sections.map((g) => g.key)).not.toContain('none')
  })

  it('follow-up grouping uses the list vocabulary with a trailing No Follow-up', () => {
    const anchor = startOfDay(new Date('2026-04-15T00:00:00'))
    const todos = [
      makeTodo({ id: 1, nextFollowupAt: new Date(anchor.getTime() - MS_PER_DAY) }),
      makeTodo({ id: 2, nextFollowupAt: anchor }),
      makeTodo({ id: 3, nextFollowupAt: new Date(anchor.getTime() + 30 * MS_PER_DAY) }),
      makeTodo({ id: 4 }),
    ]
    const list = buildList(FOLLOWUP_GROUPED_DEF, todos, makeCtx({ today: anchor }))
    expect(list.sections.map((g) => [g.key, g.label])).toEqual([
      ['overdue', 'Overdue'], ['today', 'Today'], ['later', 'Later'], ['none', 'No Follow-up'],
    ])
  })
})

describe('buildList — no list caps', () => {
  it('returns every matching task (no TOP_N)', () => {
    const future = new Date(today.getTime() + 30 * MS_PER_DAY)
    const todos = Array.from({ length: 47 }, (_, i) =>
      makeTodo({ id: i + 1, dueDate: future }),
    )
    const list = buildList(customDef(), todos, makeCtx())
    expect(list.todos).toHaveLength(47)
  })
})

describe('buildList — visibility via def predicate', () => {
  // Realistic evalPredicate: the def's predicate controls completed visibility.
  const evalByPredicate = (p: TodoPredicate, t: PersistedTodoItem) => {
    if (t.isCompleted && !p.showCompleted) return false
    return true
  }

  it('completed tasks excluded when def predicate hides them', () => {
    const t = makeTodo({ id: 1, isCompleted: true })
    const list = buildList(customDef(), [t], makeCtx({ evalPredicate: evalByPredicate }))
    expect(list.todos).toHaveLength(0)
  })

  it('completed tasks included when def predicate shows them', () => {
    const t = makeTodo({ id: 1, isCompleted: true })
    const def = customDef({ membership: { kind: 'custom', predicate: { ...emptyPredicate(), showCompleted: true } } })
    const list = buildList(def, [t], makeCtx({ evalPredicate: evalByPredicate }))
    expect(list.todos).toHaveLength(1)
  })
})

describe('week boundary for due-date buckets', () => {
  it('Sunday-first vs Monday-first place a Sunday differently', () => {
    // 2026-04-15 is Wed. Mon-first: Sunday 4/19 is the last day of this week.
    // Sun-first: the week ended Saturday 4/18, so Sunday is later.
    const anchor = startOfDay(new Date('2026-04-15T00:00:00'))
    const sunday = startOfDay(new Date(anchor.getTime() + 4 * MS_PER_DAY)) // 2026-04-19
    const t = makeTodo({ id: 1, dueDate: sunday })

    const monFirst = buildList(DEADLINE_GROUPED_DEF, [t], makeCtx({ today: anchor, weekStartsOn: 1 }))
    expect(monFirst.sections.find((g) => g.key === 'week')?.todos.map((x) => x.id)).toContain(1)

    const sunFirst = buildList(DEADLINE_GROUPED_DEF, [t], makeCtx({ today: anchor, weekStartsOn: 0 }))
    expect(sunFirst.sections.find((g) => g.key === 'later')?.todos.map((x) => x.id)).toContain(1)
    expect(sunFirst.sections.find((g) => g.key === 'week')).toBeUndefined()
  })
})

describe('buildList — sort fields', () => {
  it('sortBy=deadline sorts by dueDate only', () => {
    const a = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 5 * MS_PER_DAY) })
    const b = makeTodo({ id: 2, dueDate: new Date(today.getTime() + 1 * MS_PER_DAY) })
    const def = customDef({
      sort: 'deadline',
    })
    const list = buildList(def, [a, b], makeCtx())
    expect(list.todos.map((t) => t.id)).toEqual([2, 1])
  })

  it('sortBy=name sorts alphabetically', () => {
    const a = makeTodo({ id: 1, title: 'banana', sortOrder: 1 })
    const b = makeTodo({ id: 2, title: 'Apple', sortOrder: 2 })
    const def = customDef({ sort: 'name' })
    const list = buildList(def, [a, b], makeCtx())
    expect(list.todos.map((t) => t.id)).toEqual([2, 1])
  })

  it('sortBy=people falls back to sortOrder (categorical ambiguity)', () => {
    const a = makeTodo({ id: 1, sortOrder: 200 })
    const b = makeTodo({ id: 2, sortOrder: 100 })
    const def = customDef({
      sort: 'people',
    })
    const list = buildList(def, [a, b], makeCtx())
    expect(list.todos.map((t) => t.id)).toEqual([2, 1])
  })
})

// Sort and grouping are independent literals; lists that want them coupled
// set both to the same value.
describe('buildList — sort and grouping on the same field', () => {
  it('grouping=deadline with sort=deadline reuses relative-deadline buckets', () => {
    const overdue = makeTodo({ id: 1, dueDate: new Date(today.getTime() - 5 * MS_PER_DAY) })
    const def = customDef({
      sort: 'deadline',
      grouping: 'deadline',
    })
    const list = buildList(def, [overdue], makeCtx())
    expect(list.sections?.[0]!.key).toBe('overdue')
  })

  it('grouping=people with sort=people buckets via registry + assigned map', () => {
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
      sort: 'people',
      grouping: 'people',
    })
    const list = buildList(def, [t1, t2, t3], makeCtx({
      people: [ALICE, BOB],
      assignedPeopleMap,
    }))
    const groups = list.sections
    expect(groups.map((g) => g.key)).toEqual(['person-1', 'person-2', 'unassigned'])
    expect(groups[0]!.todos.map((t) => t.id).sort()).toEqual([101, 102])
    expect(groups[1]!.todos.map((t) => t.id)).toEqual([102])
    expect(groups[2]!.todos.map((t) => t.id)).toEqual([103])
  })

  it("grouping='none' returns one 'all' section regardless of sort", () => {
    const t = makeTodo({ id: 1 })
    const def = customDef({
      sort: 'manual',
      grouping: 'none',
    })
    const list = buildList(def, [t], makeCtx())
    expect(list.sections.map((g) => g.key)).toEqual(['all'])
  })
})

describe('buildList — tag grouping', () => {
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
    const def = customDef({ grouping: 'tag' })
    const list = buildList(def, [a, b], makeCtx({ assignedTagsMap }))
    const groups = list.sections
    expect(groups.map((g) => g.key)).toEqual(['tag-10', 'tag-20'])
    expect(groups.map((g) => g.label)).toEqual(['#urgent', '#work'])
    expect(groups[0]!.todos.map((t) => t.id).sort()).toEqual([1, 2])
    expect(groups[1]!.todos.map((t) => t.id)).toEqual([1])
  })

  it('routes untagged todos into a trailing "No Tag" bucket', () => {
    const tagged = makeTodo({ id: 1 })
    const untagged = makeTodo({ id: 2 })
    const assignedTagsMap = new Map<number, Tag[]>([
      [1, [URGENT]],
      // 2 has no entry
    ])
    const def = customDef({ grouping: 'tag' })
    const list = buildList(def, [tagged, untagged], makeCtx({ assignedTagsMap }))
    const groups = list.sections
    expect(groups.map((g) => g.key)).toEqual(['tag-10', 'no-tag'])
    expect(groups[1]!.label).toBe('No Tag')
    expect(groups[1]!.todos.map((t) => t.id)).toEqual([2])
  })

  it('sorts tag buckets alphabetically by registry name', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const assignedTagsMap = new Map<number, Tag[]>([
      [1, [ZETA]],
      [2, [ALPHA]],
      [3, [MU]],
    ])
    const def = customDef({ grouping: 'tag' })
    const list = buildList(def, todos, makeCtx({ assignedTagsMap }))
    expect(list.sections.map((g) => g.key)).toEqual(['tag-30', 'tag-40', 'tag-50'])
    expect(list.sections.map((g) => g.label)).toEqual(['#alpha', '#mu', '#zeta'])
  })

  it('returns an empty list (not undefined) when no todos match', () => {
    const def = customDef({ grouping: 'tag' })
    const list = buildList(def, [], makeCtx())
    expect(list.sections).toEqual([])
  })

  it('without an assignedTagsMap, every todo lands in the "No Tag" bucket', () => {
    const a = makeTodo({ id: 1 })
    const def = customDef({ grouping: 'tag' })
    const list = buildList(def, [a], makeCtx())
    expect(list.sections).toEqual([
      { key: 'no-tag', label: 'No Tag', accentColor: 'var(--color-text-muted)', todos: [a] },
    ])
  })
})

// The visible-groups intersection rule applies to list widgets too. A
// multi-assignee task surviving the membership filter must NOT emit
// groups for non-picked assignees just because grouping=people / tag.
describe('buildList — restrict-mode grouping', () => {
  const ALICE: Person = { id: 1, name: 'Alice', initials: 'A' }
  const BOB: Person = { id: 2, name: 'Bob', initials: 'B' }
  const CHARLIE: Person = { id: 3, name: 'Charlie', initials: 'C' }
  const URGENT: Tag = { id: 10, name: 'urgent', color: '#f00' }
  const LATER: Tag = { id: 20, name: 'later', color: '#0f0' }

  it('person restrict narrows groups to picked ids; non-picked assignees absent', async () => {
    // T1 is assigned to Alice + Charlie. Filter restricts to [Alice]; only
    // the Alice section is emitted — Charlie's assignment doesn't leak into
    // a section of its own.
    const { predicateToCriteria } = await import('../../utils/filter-criteria')
    const assignedPersonIds = new Map<number, number[]>([[101, [ALICE.id!, CHARLIE.id!]]])
    const evalPredicate = (p: TodoPredicate, t: PersistedTodoItem) =>
      matchesFilter(predicateToCriteria(p), t, assignedPersonIds.get(t.id) ?? [])
    const def = customDef({
      grouping: 'people',
      membership: {
        kind: 'custom',
        predicate: { ...emptyPredicate(), personIds: [ALICE.id!] },
      },
    })
    const t = makeTodo({ id: 101 })
    const ctx = makeCtx({
      evalPredicate,
      people: [ALICE, BOB, CHARLIE],
      assignedPeopleMap: new Map<number, Person[]>([[101, [ALICE, CHARLIE]]]),
    })
    const list = buildList(def, [t], ctx)
    const groups = list.sections
    expect(groups.map((g) => g.key)).toEqual(['person-1'])
    expect(groups[0]!.label).toBe('Alice')
    expect(groups[0]!.todos.map((x) => x.id)).toEqual([101])
  })

  it('tag restrict narrows groups to picked tag ids; non-picked tags + untagged absent', async () => {
    // T101 is tagged [#urgent, #later]. Filter restricts to [#urgent]; the
    // #later bucket must NOT emit. The untagged bucket is also suppressed
    // in restrict mode (no axis-less tasks survive a non-empty tags clause
    // anyway, but the suppression is explicit so a rogue task can't sneak in).
    const { predicateToCriteria } = await import('../../utils/filter-criteria')
    const assignedTagsMap = new Map<number, Tag[]>([[101, [URGENT, LATER]]])
    const evalPredicate = (p: TodoPredicate, t: PersistedTodoItem) => {
      const criteria = predicateToCriteria(p)
      const assignedTagIds = (assignedTagsMap.get(t.id) ?? []).map((tg) => tg.id!)
      return matchesFilter(
        criteria, t,
        undefined, undefined, undefined,
        assignedTagIds,
      )
    }
    const def = customDef({
      grouping: 'tag',
      membership: {
        kind: 'custom',
        predicate: { ...emptyPredicate(), tags: [URGENT.id!] },
      },
    })
    const t = makeTodo({ id: 101 })
    const ctx = makeCtx({ evalPredicate, assignedTagsMap })
    const list = buildList(def, [t], ctx)
    const groups = list.sections
    expect(groups.map((g) => g.key)).toEqual(['tag-10'])
    expect(groups[0]!.label).toBe('#urgent')
    expect(groups.find((g) => g.key === 'no-tag')).toBeUndefined()
  })
})
