import { describe, it, expect } from 'vitest'
import {
  OR_GROUPS_MAX,
  emptyFilterClauses,
  emptyPredicate,
  type FilterClauses,
  type PersistedTodoItem,
  type Person,
  type Status,
  type Tag,
  type TodoPredicate,
} from '../../models'
import { countActiveFilters, criteriaToPredicate, predicateToCriteria, type FilterCriteria } from '../../utils/filter-criteria'
import { applyFilter, createPredicateEvaluator, createScreenComposedEvaluator } from '../../utils/filter-match'
import {
  hasFilterClause,
  hasOrGroups,
  normalizeClauses,
  normalizeOrGroups,
  withNormalizedOrGroups,
  withOrGroupClauses,
} from '../../utils/or-groups'
import { withLens } from '../../utils/lens'
import { predicateToFilterDefaults } from '../../utils/filter-defaults'
import { applyRuntimeFilter } from '../../services/build-list'
import { currentFilterSettings } from '../../stores/settings-store'
import type { TodoNameLookups } from '../../utils/filter'
import { makeTodo } from '../helpers'

const today = new Date(2026, 9, 14)

const ann: Person = { id: 1, name: 'Ann', initials: 'A' }
const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
const work: Tag = { id: 1, name: 'work', color: '#36c' }
const home: Tag = { id: 2, name: 'home', color: '#c84' }
const doing: Status = { id: 1, name: 'Doing', color: '#0a0', sortOrder: 0 }
const waiting: Status = { id: 2, name: 'Waiting', color: '#aa0', sortOrder: 1 }
const done: Status = { id: 3, name: 'Done', color: '#0aa', sortOrder: 2 }

/**
 * 1 Ann · Doing · work; 2 Bob · Waiting · home · important; 3 Ann + Bob ·
 * Done · work + home · due today; 4 nobody · no status · untagged · "invoice";
 * 5 Ann · Doing · completed.
 */
const todos: PersistedTodoItem[] = [
  makeTodo({ id: 1, title: 'one', statusId: 1 }),
  makeTodo({ id: 2, title: 'two', statusId: 2, important: true }),
  makeTodo({ id: 3, title: 'three', statusId: 3, dueDate: today }),
  makeTodo({ id: 4, title: 'four invoice' }),
  makeTodo({ id: 5, title: 'five', statusId: 1, isCompleted: true }),
]
const people = new Map([[1, [ann]], [2, [bob]], [3, [ann, bob]], [5, [ann]]])
const tags = new Map([[1, [work]], [2, [home]], [3, [work, home]]])
const statuses = [doing, waiting, done]
const lookups: TodoNameLookups = { assignedPeopleMap: people, assignedTagsMap: tags, statusesById: new Map(statuses.map((s) => [s.id!, s])) }

const clauses = (patch: Partial<FilterClauses>): FilterClauses => ({ ...emptyFilterClauses(), ...patch })
const predicate = (patch: Partial<TodoPredicate>): TodoPredicate => ({ ...emptyPredicate(), ...patch })
const ids = (f: FilterCriteria) => applyFilter(f, todos, people, statuses, today, tags, currentFilterSettings()).map((t) => t.id)
const idsOf = (p: TodoPredicate) => ids(predicateToCriteria(p))

/** One clause per field, as a chip makes it. */
const CLAUSES: Array<[string, Partial<FilterClauses>]> = [
  ['Status', { statusIds: [2, 3] }],
  ['People', { personIds: [2] }],
  ['People Unassigned', { personIds: [0] }],
  ['Tags', { tags: [1] }],
  ['Priority', { markers: { important: true } }],
  ['Text', { searchText: 'invoice' }],
  ['Text naming a person', { searchText: 'bob' }],
  ['Due date', { dates: { deadline: { match: 'set' } } }],
  ['Created date', { dates: { created: { match: 'range', start: null, end: { kind: 'offset', days: 0 } } } }],
  ['Status is not', { statusIds: [1], negate: { statusIds: true } }],
]

describe('evaluating or groups', () => {
  it.each(CLAUSES)('an or group of one %s clause keeps what the clause keeps outside it', (_name, patch) => {
    expect(idsOf(predicate({ orGroups: [clauses(patch)] }))).toEqual(idsOf(predicate(patch)))
  })

  it('an or group keeps a task passing any of its clauses; the clauses outside it still all apply', () => {
    const group = clauses({ statusIds: [2], tags: [1] })
    expect(idsOf(predicate({ orGroups: [group] }))).toEqual([1, 2, 3])
    expect(idsOf(predicate({ personIds: [1], orGroups: [group] }))).toEqual([1, 3])
  })

  it('every or group must pass (AND between them)', () => {
    const urgentOrWork = clauses({ tags: [1], markers: { important: true } })
    const bobOrNobody = clauses({ personIds: [2, 0] })
    expect(idsOf(predicate({ orGroups: [urgentOrWork, bobOrNobody] }))).toEqual([2, 3])
  })

  it('reads an "is not" clause inside an or group as outside it', () => {
    // Not Ann (2, 4) or Doing (1).
    expect(idsOf(predicate({ orGroups: [clauses({ personIds: [1], negate: { personIds: true }, statusIds: [1] })] }))).toEqual([1, 2, 4])
    // Has a tag (1, 2, 3) or nobody (4).
    expect(idsOf(predicate({ orGroups: [clauses({ tags: [0], negate: { tags: true }, personIds: [0] })] }))).toEqual([1, 2, 3, 4])
  })

  it('an untagged task passes an or group holding a No tags chip', () => {
    expect(idsOf(predicate({ orGroups: [clauses({ tags: [0], statusIds: [2] })] }))).toEqual([2, 4])
  })

  it('an "is" chip with nothing ticked inside an or group keeps nothing by itself', () => {
    expect(idsOf(predicate({ orGroups: [clauses({ tags: [] })] }))).toEqual([])
    expect(idsOf(predicate({ orGroups: [clauses({ tags: [], statusIds: [2] })] }))).toEqual([2])
  })

  it('completion is the predicate\'s alone: an or group never brings a completed task back', () => {
    const group = clauses({ statusIds: [1] })
    expect(idsOf(predicate({ orGroups: [group] }))).toEqual([1])
    expect(idsOf(predicate({ showCompleted: true, orGroups: [group] }))).toEqual([1, 5])
    // A stray Show completed inside an or group is not read.
    const stray = { ...group, showCompleted: true } as FilterClauses
    expect(idsOf(predicate({ orGroups: [stray] }))).toEqual([1])
    expect(predicateToCriteria(predicate({ orGroups: [stray] })).orGroups?.[0]).not.toHaveProperty('showCompleted')
  })

  it('an or group that filters nothing keeps every task (built by hand: the stored form never has one)', () => {
    expect(ids({ ...predicateToCriteria(emptyPredicate()), orGroups: [predicateToCriteria(emptyPredicate())] })).toEqual([1, 2, 3, 4])
  })

  it('a stored list predicate with an or group evaluates the same through the list evaluator', () => {
    const evaluate = createPredicateEvaluator(lookups, today, currentFilterSettings())
    const p = predicate({ orGroups: [clauses({ searchText: 'ann', tags: [2] })] })
    expect(todos.filter((t) => evaluate(p, t)).map((t) => t.id)).toEqual([1, 2, 3])
  })

  it('an or group in the lens applies under the top bar\'s chips, its text read with the task\'s names', () => {
    const screen = predicateToCriteria(predicate({ tags: [1, 2] }))
    const lens = { id: 'l', name: 'Bob or important', predicate: predicate({ orGroups: [clauses({ searchText: 'bob', markers: { important: true } })] }) }
    expect(ids(withLens(screen, lens))).toEqual([2, 3])
    expect(countActiveFilters(withLens(screen, lens))).toBe(2)
  })

  it('a list\'s or group composes with the screen filter (both stages must pass)', () => {
    const screen = predicateToCriteria(predicate({ personIds: [1] }))
    const evaluate = createScreenComposedEvaluator(screen, lookups, today, currentFilterSettings())
    const list = predicate({ orGroups: [clauses({ statusIds: [2, 3], tags: [0] })] })
    expect(todos.filter((t) => evaluate(list, t)).map((t) => t.id)).toEqual([3])
  })
})

describe('or groups between the stored and the runtime filter', () => {
  const stored = predicate({
    statusIds: [1],
    orGroups: [
      clauses({ markers: 'hot', dates: { deadline: { match: 'range', start: { kind: 'relative', token: 'today' }, end: null } } }),
      clauses({ personIds: [2], tags: [0], negate: { personIds: true } }),
    ],
  })

  it('round-trips: runtime → stored gives the same predicate', () => {
    const runtime = predicateToCriteria(stored)
    expect(runtime.orGroups?.[1]?.personIds).toEqual(new Set([2]))
    expect(criteriaToPredicate(runtime)).toEqual(stored)
  })

  it('leaves out or groups that filter nothing, and the key with the last one', () => {
    const runtime = predicateToCriteria(predicate({ orGroups: [emptyFilterClauses()] }))
    expect('orGroups' in runtime).toBe(false)
    expect('orGroups' in criteriaToPredicate({ ...runtime, orGroups: [predicateToCriteria(emptyPredicate())] })).toBe(false)
    expect(criteriaToPredicate(predicateToCriteria(emptyPredicate()))).toEqual(emptyPredicate())
  })

  it('or groups are not counted as screen filters', () => {
    expect(countActiveFilters(predicateToCriteria(stored))).toBe(1)
  })
})

describe('normalising or groups', () => {
  it('hasFilterClause: any clause that filters', () => {
    expect(hasFilterClause(emptyFilterClauses())).toBe(false)
    expect(hasFilterClause(clauses({ markers: {} }))).toBe(false)
    expect(hasFilterClause(clauses({ dates: { deadline: { match: 'range', start: null, end: null } } }))).toBe(false)
    for (const [, patch] of CLAUSES) expect(hasFilterClause(clauses(patch))).toBe(true)
    expect(hasFilterClause(clauses({ tags: [] }))).toBe(true)
  })

  it('normalizeClauses: the narrowing fields alone, in stored form, "is not" normalised', () => {
    const raw = {
      ...emptyPredicate(), showCompleted: true, orGroups: [clauses({ tags: [1] })], markers: {},
      statusIds: [], tags: [2], negate: { statusIds: true, tags: true },
      dates: { created: { match: 'set' }, followup: { match: 'range', start: null, end: { kind: 'offset', days: 2 }, includeNoDate: false } },
    } as TodoPredicate
    expect(normalizeClauses(raw)).toEqual({
      personIds: null, statusIds: null, searchText: '', markers: null, tags: [2], negate: { tags: true },
      dates: { followup: { match: 'range', start: null, end: { kind: 'offset', days: 2 } } },
    })
    const { markers: _markers, tags: _tags, ...required } = emptyFilterClauses()
    void _markers
    void _tags
    expect(normalizeClauses(required as FilterClauses)).toEqual(emptyFilterClauses())
  })

  it('normalizeOrGroups: drops the or groups that filter nothing, keeps the order, caps the count', () => {
    const a = clauses({ tags: [1] })
    const b = clauses({ personIds: [], negate: { personIds: true } })
    expect(normalizeOrGroups([a, b, emptyFilterClauses(), clauses({ statusIds: [2] })])).toEqual([a, clauses({ statusIds: [2] })])
    expect(normalizeOrGroups(undefined)).toEqual([])
    const many = Array.from({ length: OR_GROUPS_MAX + 2 }, (_, i) => clauses({ tags: [i + 1] }))
    expect(normalizeOrGroups(many)).toEqual(many.slice(0, OR_GROUPS_MAX))
  })

  it('withNormalizedOrGroups: the key only while an or group is left; the same object without one', () => {
    const p = predicate({ tags: [1] })
    expect(withNormalizedOrGroups(p)).toBe(p)
    expect(withNormalizedOrGroups(predicate({ orGroups: [emptyFilterClauses()] }))).toEqual(emptyPredicate())
    expect('orGroups' in withNormalizedOrGroups(predicate({ orGroups: [] }))).toBe(false)
    expect(withNormalizedOrGroups(predicate({ orGroups: [clauses({ tags: [1] })] })).orGroups).toEqual([clauses({ tags: [1] })])
  })

  it('hasOrGroups: an or group that filters', () => {
    expect(hasOrGroups(emptyPredicate())).toBe(false)
    expect(hasOrGroups(predicate({ orGroups: [emptyFilterClauses()] }))).toBe(false)
    expect(hasOrGroups(predicate({ orGroups: [clauses({ markers: 'hot' })] }))).toBe(true)
  })

  it('withOrGroupClauses edits one or group, adds one past the last, and drops one left with nothing', () => {
    const hot = clauses({ markers: 'hot' })
    const p = predicate({ orGroups: [hot] })
    expect(withOrGroupClauses(p, 0, (c) => ({ ...c, tags: [1] })).orGroups).toEqual([{ ...hot, tags: [1] }])
    expect(withOrGroupClauses(p, 1, (c) => ({ ...c, statusIds: [2] })).orGroups).toEqual([hot, clauses({ statusIds: [2] })])
    expect(withOrGroupClauses(p, 0, (c) => ({ ...c, markers: null }))).toEqual(emptyPredicate())
    expect(withOrGroupClauses(p, 2, (c) => c)).toBe(p)
    expect(withOrGroupClauses(p, -1, (c) => c)).toBe(p)
    const full = predicate({ orGroups: Array.from({ length: OR_GROUPS_MAX }, (_, i) => clauses({ tags: [i + 1] })) })
    expect(withOrGroupClauses(full, OR_GROUPS_MAX, (c) => ({ ...c, markers: 'hot' }))).toBe(full)
  })
})

describe('what reads only the clauses outside the or groups', () => {
  it('a new task seeds nothing from an or group', () => {
    expect(predicateToFilterDefaults(predicate({ orGroups: [clauses({ personIds: [1], tags: [2], statusIds: [1], markers: { urgent: true } })] })))
      .toEqual({ personIds: [], tagIds: [], statusId: undefined })
    expect(predicateToFilterDefaults(predicate({ tags: [2], orGroups: [clauses({ personIds: [1] })] })).tagIds).toEqual([2])
  })

  it('a Prompt for pick merges into the clauses outside the or groups and keeps them', () => {
    const group = clauses({ personIds: [2], markers: 'hot' })
    expect(applyRuntimeFilter(predicate({ orGroups: [group] }), { field: 'person' }, [1])).toEqual(predicate({ personIds: [1], orGroups: [group] }))
  })
})
