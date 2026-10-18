import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterStore } from '../../stores/filter-store'
import { criteriaToPredicate, fixedAnchor, predicateToCriteria } from '../../utils/filter-criteria'
import { buildList, type ListBuildContext } from '../../services/build-list'
import { buildListSections, listSortComparator } from '../../services/list-sections'
import { partitionByGroup, type GroupingContext } from '../../utils/task-grouping'
import { resolveCrossGroupMutation } from '../../utils/cross-group-drag'
import { defsEqual } from '../../utils/list-def-equal'
import { rowFixes, validateRow } from '../../data/import-validation'
import { emptyPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import type { PersistedTodoItem } from '../../models'
import { makeTodo, matchesFilterNow as matchesFilter, patchScreenFilter } from '../helpers'

// Wed 14 Oct 2026 (Monday-first week ends Sun 18 Oct).
const today = new Date(2026, 9, 14)
const day = (m: number, d: number) => new Date(2026, m - 1, d)

const overdue = makeTodo({ id: 1, title: 'overdue', sortOrder: 1, nextFollowupAt: day(10, 12) })
const dueToday = makeTodo({ id: 2, title: 'today', sortOrder: 2, nextFollowupAt: new Date(2026, 9, 14, 0, 0) })
const thisWeek = makeTodo({ id: 3, title: 'this week', sortOrder: 3, nextFollowupAt: day(10, 17) })
const later = makeTodo({ id: 4, title: 'later', sortOrder: 4, nextFollowupAt: day(11, 30) })
const none = makeTodo({ id: 5, title: 'none', sortOrder: 0 })
const all: PersistedTodoItem[] = [later, none, thisWeek, overdue, dueToday]

beforeEach(() => {
  useFilterStore.getState().clearAll()
})

describe('filter: the follow-up date', () => {
  const f = () => useFilterStore.getState().filters

  it('Has a date / No date: with, without; no clause = all', () => {
    expect(all.filter((t) => matchesFilter(f(), t, undefined, today))).toHaveLength(5)
    patchScreenFilter({ dates: { followup: { match: 'set' } } })
    expect(useFilterStore.getState().isActive).toBe(true)
    expect(all.filter((t) => matchesFilter(f(), t, undefined, today)).map((t) => t.id))
      .toEqual([4, 3, 1, 2])
    patchScreenFilter({ dates: { followup: { match: 'unset' } } })
    expect(all.filter((t) => matchesFilter(f(), t, undefined, today)).map((t) => t.id))
      .toEqual([5])
  })

  it('date range on the next follow-up', () => {
    patchScreenFilter({ dates: { followup: { match: 'range', start: fixedAnchor(day(10, 14)), end: fixedAnchor(day(10, 18)) } } })
    expect(all.filter((t) => matchesFilter(f(), t, undefined, today)).map((t) => t.id))
      .toEqual([3, 2])
  })

  it('round-trips through the stored predicate', () => {
    patchScreenFilter({ dates: { followup: { match: 'unset' } } })
    const p = criteriaToPredicate(f())
    expect(p.dates).toEqual({ followup: { match: 'unset' } })
    expect(predicateToCriteria(p).dates).toEqual({ followup: { match: 'unset' } })
  })

  it('list-definition equality sees the follow-up clause; a range with no end equals none', () => {
    const base: PersistedListDefinition = {
      id: 1, name: 'L', sortOrder: 0,
      membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'followup', grouping: 'followup',
    }
    const withOpenRange: PersistedListDefinition = { ...base, membership: { kind: 'custom', predicate: { ...emptyPredicate(), dates: { followup: { match: 'range', start: null, end: null } } } } }
    const withSet: PersistedListDefinition = { ...base, membership: { kind: 'custom', predicate: { ...emptyPredicate(), dates: { followup: { match: 'set' } } } } }
    expect(defsEqual(base, withOpenRange)).toBe(true)
    expect(defsEqual(base, withSet)).toBe(false)
  })
})

describe('sort + group by next follow-up', () => {
  it('sections: Overdue / Today / This Week / Later, then No Follow-up', () => {
    const sections = buildListSections(all, { groupBy: 'followup', sortBy: 'manual' }, {
      today, weekStartsOn: 1, people: [], statuses: [],
      assignedPeopleMap: new Map(), assignedTagsMap: new Map(),
    })
    expect(sections.map((s) => [s.label, s.todos.map((t) => t.id)])).toEqual([
      ['Overdue', [1]],
      ['Today', [2]],
      ['This Week', [3]],
      ['Later', [4]],
      ['No Follow-up', [5]],
    ])
  })

  it('sort ascending, tasks without a follow-up last', () => {
    const cmp = listSortComparator('followup')
    expect([...all].sort(cmp).map((t) => t.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('list widgets use the same vocabulary and sort', () => {
    const ctx: ListBuildContext = { today, weekStartsOn: 1, evalPredicate: () => true }
    const def: PersistedListDefinition = {
      id: 9, name: 'Follow-ups', sortOrder: 0, 
      membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'followup', grouping: 'followup',
    }
    const list = buildList(def, all, ctx)
    expect(list.todos.map((t) => t.id)).toEqual([1, 2, 3, 4, 5])
    expect(list.sections.map((g) => [g.label, g.todos.map((t) => t.id)])).toEqual([
      ['Overdue', [1]],
      ['Today', [2]],
      ['This Week', [3]],
      ['Later', [4]],
      ['No Follow-up', [5]],
    ])
  })

  it('partitionByGroup buckets on the next follow-up', () => {
    const ctx: GroupingContext = {
      assignedPeopleMap: new Map(), assignedTagsMap: new Map(),
      statuses: [], today, weekStartsOn: 1,
    }
    const { groups, ungrouped } = partitionByGroup(all, 'followup', ctx)
    expect(groups.map((g) => [g.label, g.todos.map((t) => t.id)])).toEqual([
      ['Overdue', [1]],
      ['Today', [2]],
      ['This Week', [3]],
      ['Later', [4]],
    ])
    expect(ungrouped.map((t) => t.id)).toEqual([5])
  })

  it('dragging between follow-up buckets never rewrites the date', () => {
    expect(resolveCrossGroupMutation('followup', 'overdue', 'later', 1)).toBeNull()
  })
})

describe('import validation', () => {
  const todo = { uid: 'u1', title: 'T', isCompleted: false, createdAt: '2026-10-01T00:00:00.000Z', modifiedAt: '2026-10-01T00:00:00.000Z', sortOrder: 0 }

  it('accepts follow-up dates on todos, rejects junk', () => {
    expect(validateRow('todos', { ...todo, lastFollowupAt: '2026-10-02T10:00:00.000Z', nextFollowupAt: '2026-11-02T00:00:00.000Z' })).toBe(true)
    expect(validateRow('todos', { ...todo, nextFollowupAt: 'soon' })).not.toBe(true)
  })

  it('accepts a compact default interval setting, rejects anything else', () => {
    expect(validateRow('settings', { key: 'followupDefaultInterval', value: '2w' })).toBe(true)
    expect(validateRow('settings', { key: 'followupDefaultInterval', value: 'fortnight' })).not.toBe(true)
    expect(validateRow('settings', { key: 'followupDefaultInterval', value: '0d' })).not.toBe(true)
  })

  it('accepts a follow-up clause on stored predicates; drops a malformed one with a warning', () => {
    const def = {
      name: 'L', sortOrder: 0, sort: 'followup', grouping: 'followup',
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), dates: { followup: { match: 'set' } } } },
    }
    expect(validateRow('listDefinitions', def)).toBe(true)
    expect(rowFixes('listDefinitions', def)).toEqual([])
    const bad = { ...def, membership: { kind: 'custom', predicate: { ...emptyPredicate(), dates: { followup: { match: 'yes' } } } } }
    expect(validateRow('listDefinitions', bad)).toBe(true)
    expect(rowFixes('listDefinitions', bad)).toEqual(['follow-up date filter dropped'])
  })
})
