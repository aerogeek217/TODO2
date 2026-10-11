import { describe, it, expect, beforeEach } from 'vitest'
import {
  useFilterStore,
  matchesFilter,
  criteriaToPredicate,
  predicateToCriteria,
} from '../../stores/filter-store'
import { buildDashboardLists, type DashboardListsContext } from '../../services/dashboard-lists'
import { buildListSections, listSortComparator } from '../../services/list-sections'
import { partitionByGroup, type GroupingContext } from '../../utils/task-grouping'
import { resolveCrossGroupMutation } from '../../utils/cross-group-drag'
import { defsEqual } from '../../utils/list-def-equal'
import { validateRow } from '../../data/import-validation'
import { emptyPredicate } from '../../stores/list-definition-store'
import type { PersistedListDefinition } from '../../models/list-definition'
import type { PersistedTodoItem } from '../../models'
import { makeTodo } from '../helpers'

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

describe('filter: hasFollowup + dateField followup', () => {
  const f = () => useFilterStore.getState().filters

  it('tri-state presence: null = all, true = with, false = without', () => {
    expect(all.filter((t) => matchesFilter(f(), t, undefined, today))).toHaveLength(5)
    useFilterStore.getState().setHasFollowup(true)
    expect(useFilterStore.getState().isActive).toBe(true)
    expect(all.filter((t) => matchesFilter(f(), t, undefined, today)).map((t) => t.id))
      .toEqual([4, 3, 1, 2])
    useFilterStore.getState().setHasFollowup(false)
    expect(all.filter((t) => matchesFilter(f(), t, undefined, today)).map((t) => t.id))
      .toEqual([5])
  })

  it('date range on the next follow-up', () => {
    useFilterStore.getState().setDateField('followup')
    useFilterStore.getState().setDateRange(day(10, 14), day(10, 18))
    expect(all.filter((t) => matchesFilter(f(), t, undefined, today)).map((t) => t.id))
      .toEqual([3, 2])
  })

  it('round-trips through the stored predicate; predicates without the key read as no filter', () => {
    useFilterStore.getState().setHasFollowup(false)
    const p = criteriaToPredicate(f())
    expect(p.hasFollowup).toBe(false)
    expect(predicateToCriteria(p).hasFollowup).toBe(false)
    const legacy = { ...p }
    delete legacy.hasFollowup
    expect(predicateToCriteria(legacy).hasFollowup).toBeNull()
  })

  it('list-definition equality sees hasFollowup (absent == null)', () => {
    const base: PersistedListDefinition = {
      id: 1, name: 'L', sortOrder: 0, pinnedToDashboard: false, favorited: false,
      membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'followup', grouping: 'followup',
    }
    const withNull: PersistedListDefinition = { ...base, membership: { kind: 'custom', predicate: { ...emptyPredicate(), hasFollowup: null } } }
    const legacyPredicate = { ...emptyPredicate() }
    delete legacyPredicate.hasFollowup
    const legacy: PersistedListDefinition = { ...base, membership: { kind: 'custom', predicate: legacyPredicate } }
    const withTrue: PersistedListDefinition = { ...base, membership: { kind: 'custom', predicate: { ...emptyPredicate(), hasFollowup: true } } }
    expect(defsEqual(withNull, legacy)).toBe(true)
    expect(defsEqual(withNull, withTrue)).toBe(false)
  })
})

describe('sort + group by next follow-up', () => {
  it('sections: Overdue / Today / This Week / Later, then No Follow-up', () => {
    const sections = buildListSections(all, { groupBy: 'followup', sortBy: 'manual' }, {
      today, weekStartsOn: 1, people: [], statuses: [], projects: [],
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
    const ctx: DashboardListsContext = { today, weekStartsOn: 1, evalPredicate: () => true }
    const def: PersistedListDefinition = {
      id: 9, name: 'Follow-ups', sortOrder: 0, pinnedToDashboard: false, favorited: false,
      membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'followup', grouping: 'followup',
    }
    const [list] = buildDashboardLists([def], all, ctx)
    expect(list!.todos.map((t) => t.id)).toEqual([1, 2, 3, 4, 5])
    expect(list!.sections.map((g) => [g.label, g.todos.map((t) => t.id)])).toEqual([
      ['Overdue', [1]],
      ['Today', [2]],
      ['This Week', [3]],
      ['Later', [4]],
      ['No Follow-up', [5]],
    ])
  })

  it('canvas/project grouping buckets on the next follow-up', () => {
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

  it('accepts hasFollowup on stored predicates, rejects non-booleans', () => {
    const def = {
      name: 'L', sortOrder: 0, sort: 'followup', grouping: 'followup',
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), dateField: 'followup', hasFollowup: true } },
    }
    expect(validateRow('listDefinitions', def)).toBe(true)
    expect(validateRow('listDefinitions', {
      ...def, membership: { kind: 'custom', predicate: { ...emptyPredicate(), hasFollowup: 'yes' } },
    })).not.toBe(true)
  })
})
