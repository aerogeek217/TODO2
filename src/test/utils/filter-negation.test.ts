import { describe, it, expect, beforeEach } from 'vitest'
import { emptyPredicate, type PersistedTodoItem, type Person, type Status, type Tag, type TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { criteriaToPredicate, countActiveFilters, predicateToCriteria, type FilterCriteria } from '../../utils/filter-criteria'
import { applyFilter, createPredicateEvaluator, matchesComposedFilter } from '../../utils/filter-match'
import {
  entityPickerSelection,
  isNegated,
  negationEqual,
  toggleExcluded,
  withIdFilter,
  withNormalizedNegation,
} from '../../utils/filter-negation'
import { getFilterDefaults, predicateToFilterDefaults } from '../../utils/filter-defaults'
import { clearChipField, describeFilters, filterChips, hasNarrowingFilters } from '../../utils/filter-chips'
import { changedListFields, defsEqual } from '../../utils/list-def-equal'
import { useFilterStore } from '../../stores/filter-store'
import { applyRuntimeFilter, buildList } from '../../services/build-list'
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

/** 1 Ann · Doing · work; 2 Bob · Waiting · home; 3 Ann + Bob · Done · work + home; 4 nobody · no status · untagged. */
const todos: PersistedTodoItem[] = [
  makeTodo({ id: 1, title: 'one', statusId: 1 }),
  makeTodo({ id: 2, title: 'two', statusId: 2 }),
  makeTodo({ id: 3, title: 'three', statusId: 3 }),
  makeTodo({ id: 4, title: 'four' }),
]
const people = new Map([[1, [ann]], [2, [bob]], [3, [ann, bob]]])
const tags = new Map([[1, [work]], [2, [home]], [3, [work, home]]])
const lookups: TodoNameLookups = { assignedPeopleMap: people, assignedTagsMap: tags, statusesById: new Map([[1, doing], [2, waiting], [3, done]]) }
const names = { people: [ann, bob], tags: [work, home], statuses: [doing, waiting, done] }

const none = (): FilterCriteria => predicateToCriteria(emptyPredicate())
const crit = (patch: Partial<FilterCriteria>): FilterCriteria => ({ ...none(), ...patch })
const ids = (f: FilterCriteria) => applyFilter(f, todos, people, [doing, waiting, done], today, tags, currentFilterSettings()).map((t) => t.id)

describe('matching an "is not" filter', () => {
  it.each([
    ['Status: not Waiting', { statusIds: new Set([2]), negate: { statusIds: true } }, [1, 3, 4]],
    ['Status is not No status', { statusIds: new Set([0]), negate: { statusIds: true } }, [1, 2, 3]],
    ['Status: not Waiting, No status', { statusIds: new Set([2, 0]), negate: { statusIds: true } }, [1, 3]],
    ['People is not Ann (none of them)', { personIds: new Set([1]), negate: { personIds: true } }, [2, 4]],
    ['People is not Unassigned (has someone)', { personIds: new Set([0]), negate: { personIds: true } }, [1, 2, 3]],
    ['People is not Ann, Unassigned', { personIds: new Set([1, 0]), negate: { personIds: true } }, [2]],
    ['Tags is not work (untagged passes)', { tags: new Set([1]), negate: { tags: true } }, [2, 4]],
    ['Tags is not work, home', { tags: new Set([1, 2]), negate: { tags: true } }, [4]],
  ] as Array<[string, Partial<FilterCriteria>, number[]]>)('%s', (_name, patch, expected) => {
    expect(ids(crit(patch))).toEqual(expected)
  })

  it('without a switch every field matches as it always has', () => {
    expect(ids(crit({ statusIds: new Set([2]) }))).toEqual([2])
    expect(ids(crit({ statusIds: new Set([0]) }))).toEqual([4])
    expect(ids(crit({ personIds: new Set([1]) }))).toEqual([1, 3])
    expect(ids(crit({ personIds: new Set([0]) }))).toEqual([4])
    expect(ids(crit({ tags: new Set([2]) }))).toEqual([2, 3])
  })

  it('a switch only turns its own field round', () => {
    expect(ids(crit({ statusIds: new Set([2]), personIds: new Set([2]), negate: { statusIds: true } }))).toEqual([3])
  })

  it('an "is not" with nothing ticked passes every task', () => {
    expect(ids(crit({ statusIds: new Set(), negate: { statusIds: true } }))).toEqual([1, 2, 3, 4])
  })

  it('a stored list predicate is matched the same way', () => {
    const evaluate = createPredicateEvaluator(lookups, today, currentFilterSettings())
    const p: TodoPredicate = { ...emptyPredicate(), personIds: [1], negate: { personIds: true } }
    expect(todos.filter((t) => evaluate(p, t)).map((t) => t.id)).toEqual([2, 4])
  })

  it('composes with the screen filter field by field: each side keeps its own switch', () => {
    const composed = (screen: FilterCriteria, list: FilterCriteria) =>
      todos.filter((t) => matchesComposedFilter(screen, list, t, lookups, today, currentFilterSettings())).map((t) => t.id)
    // Screen: Status is not Waiting. List: Status is Waiting, Done.
    expect(composed(crit({ statusIds: new Set([2]), negate: { statusIds: true } }), crit({ statusIds: new Set([2, 3]) }))).toEqual([3])
    // Screen: People is not Bob. List: Tags is not home.
    expect(composed(crit({ personIds: new Set([2]), negate: { personIds: true } }), crit({ tags: new Set([2]), negate: { tags: true } }))).toEqual([1, 4])
    // Both "is not" on the same field: neither value.
    expect(composed(crit({ personIds: new Set([1]), negate: { personIds: true } }), crit({ personIds: new Set([0]), negate: { personIds: true } }))).toEqual([2])
  })
})

describe('switch normalisation', () => {
  it('an "is not" with nothing ticked is no filter; a switch on a field that does not filter goes', () => {
    const p = withNormalizedNegation({ ...emptyPredicate(), personIds: [], statusIds: [2], negate: { personIds: true, statusIds: true, tags: true } })
    expect(p).toMatchObject({ personIds: null, statusIds: [2], negate: { statusIds: true } })
    expect(p.negate).toEqual({ statusIds: true })
    const q = withNormalizedNegation({ ...emptyPredicate(), negate: { tags: true } })
    expect('negate' in q).toBe(false)
  })

  it('returns the same object when nothing changes', () => {
    const p: TodoPredicate = { ...emptyPredicate(), statusIds: [2], negate: { statusIds: true } }
    expect(withNormalizedNegation(p)).toBe(p)
    const plain = emptyPredicate()
    expect(withNormalizedNegation(plain)).toBe(plain)
  })

  it('withIdFilter sets ids and switch together; clearing a field drops its switch', () => {
    const p = withIdFilter(emptyPredicate(), 'statusIds', [2], true)
    expect(p).toMatchObject({ statusIds: [2], negate: { statusIds: true } })
    expect(isNegated(p, 'statusIds')).toBe(true)
    // Toggling keeps the ticks.
    expect(withIdFilter(p, 'statusIds', [2], false)).toEqual({ ...emptyPredicate(), statusIds: [2] })
    expect(withIdFilter(p, 'statusIds', null, true)).toEqual(emptyPredicate())
    expect(withIdFilter(p, 'statusIds', [], true)).toEqual(emptyPredicate())
  })

  it('isNegated never throws on a stored row the import hasn’t checked (ids not a list)', () => {
    const odd = { ...emptyPredicate(), statusIds: 5, negate: { statusIds: true } } as unknown as TodoPredicate
    expect(isNegated(odd, 'statusIds')).toBe(false)
  })

  it('toggleExcluded adds and removes; nothing left = no filter', () => {
    expect(toggleExcluded(null, 2)).toEqual(new Set([2]))
    expect(toggleExcluded(new Set([2]), 3)).toEqual(new Set([2, 3]))
    expect(toggleExcluded(new Set([2]), 2)).toBeNull()
  })

  describe('entityPickerSelection (the People / Status / Tags pickers’ one rule set)', () => {
    const all = [0, 1, 2]

    it('is, no filter: every row ticked, Select all lit; a tick hides that row', () => {
      const sel = entityPickerSelection(null, false, false, all)
      expect([sel.allSelected, sel.noneSelected, all.map(sel.isChecked)]).toEqual([true, false, [true, true, true]])
      expect(sel.toggled(1)).toEqual(new Set([0, 2]))
      expect([sel.all, sel.none]).toEqual([null, new Set()])
    })

    it('is, the preview (adding): nothing ticked; the first tick narrows to it', () => {
      const sel = entityPickerSelection(null, false, true, all)
      expect([sel.previewing, sel.allSelected, sel.noneSelected, all.some(sel.isChecked)]).toEqual([true, false, true, false])
      expect(sel.toggled(1)).toEqual(new Set([1]))
    })

    it('is not: the ticked rows are the hidden ones; no preview; Select all ticks every value, Deselect all = no filter', () => {
      const sel = entityPickerSelection(new Set([1]), true, true, all)
      expect([sel.previewing, sel.allSelected, sel.noneSelected, all.map(sel.isChecked)]).toEqual([false, false, false, [false, true, false]])
      expect(sel.toggled(1)).toBeNull()
      expect(sel.toggled(2)).toEqual(new Set([1, 2]))
      expect([sel.all, sel.none]).toEqual([new Set(all), null])
      expect(entityPickerSelection(new Set(all), true, false, all).allSelected).toBe(true)
      expect(entityPickerSelection(null, true, false, all).noneSelected).toBe(true)
    })
  })

  it('negationEqual compares only switches that apply', () => {
    expect(negationEqual({ ...emptyPredicate(), negate: { tags: true } }, emptyPredicate())).toBe(true)
    expect(negationEqual({ ...emptyPredicate(), tags: [1], negate: { tags: true } }, { ...emptyPredicate(), tags: [1] })).toBe(false)
  })
})

describe('criteria ↔ predicate', () => {
  it('carries the switches both ways', () => {
    const p: TodoPredicate = { ...emptyPredicate(), personIds: [1, 0], statusIds: [2], tags: [1], negate: { personIds: true, tags: true } }
    const c = predicateToCriteria(p)
    expect(c.negate).toEqual({ personIds: true, tags: true })
    expect(criteriaToPredicate(c)).toEqual(p)
  })

  it('a predicate without switches converts without a negate key, as before', () => {
    const p: TodoPredicate = { ...emptyPredicate(), statusIds: [2] }
    expect('negate' in predicateToCriteria(p)).toBe(false)
    expect('negate' in criteriaToPredicate(predicateToCriteria(p))).toBe(false)
  })

  it('normalises on the way: an "is not" with nothing ticked becomes no filter', () => {
    const p = criteriaToPredicate(crit({ statusIds: new Set(), negate: { statusIds: true } }))
    expect(p.statusIds).toBeNull()
    expect('negate' in p).toBe(false)
  })

  it('an "is not" field counts as one active filter', () => {
    expect(countActiveFilters(crit({ statusIds: new Set([2]), negate: { statusIds: true } }))).toBe(1)
  })
})

describe('new-task defaults', () => {
  it('an "is not" field seeds nothing', () => {
    expect(getFilterDefaults(crit({ personIds: new Set([1]), statusIds: new Set([2]), tags: new Set([1]), negate: { personIds: true, statusIds: true, tags: true } })))
      .toEqual({ personIds: [], tagIds: [], statusId: undefined })
  })

  it('an "is" field next to an "is not" one still seeds', () => {
    expect(predicateToFilterDefaults({ ...emptyPredicate(), personIds: [1], statusIds: [2], negate: { statusIds: true } }))
      .toEqual({ personIds: [1], tagIds: [], statusId: undefined })
  })
})

describe('chips', () => {
  it('say "not" and spell out what they hide', () => {
    const chips = filterChips({ ...emptyPredicate(), personIds: [1, 2], statusIds: [2], tags: [1], negate: { personIds: true, statusIds: true, tags: true } }, names)
    expect(chips.map((c) => [c.label, c.value])).toEqual([['Tags', 'not #work'], ['People', 'not Ann or Bob'], ['Status', 'not Waiting']])
    expect(chips.every((c) => c.negated)).toBe(true)
    expect(chips.map((c) => c.tooltip)).toEqual([
      'Tags: not #work\nHides tasks with that tag; untagged tasks stay',
      'People: not Ann or Bob\nHides tasks assigned to any of them',
      'Status: not Waiting\nHides tasks with that status',
    ])
    expect(describeFilters(chips)).toBe('Tags not #work · People not Ann or Bob · Status not Waiting')
  })

  it('name the sentinels', () => {
    const [chip] = filterChips({ ...emptyPredicate(), personIds: [0], negate: { personIds: true } }, names)
    expect(chip).toMatchObject({ value: 'not Unassigned', tooltip: 'People: not Unassigned\nHides tasks assigned to them' })
  })

  it('an "is" chip is unchanged and has no tooltip', () => {
    const [chip] = filterChips({ ...emptyPredicate(), statusIds: [2] }, names)
    expect(chip).toEqual({ field: 'status', label: 'Status', value: 'Waiting' })
  })

  it('removing a chip drops its switch', () => {
    const p: TodoPredicate = { ...emptyPredicate(), statusIds: [2], tags: [1], negate: { statusIds: true, tags: true } }
    expect(clearChipField(p, 'status')).toEqual({ ...emptyPredicate(), tags: [1], negate: { tags: true } })
    expect(hasNarrowingFilters(clearChipField(clearChipField(p, 'status'), 'tags'))).toBe(false)
  })
})

describe('list equality', () => {
  const def = (predicate: TodoPredicate): PersistedListDefinition => ({
    id: 1, name: 'L', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate },
  })
  it('the switch counts as a filter change', () => {
    const is = def({ ...emptyPredicate(), statusIds: [2] })
    const isNot = def({ ...emptyPredicate(), statusIds: [2], negate: { statusIds: true } })
    expect(defsEqual(is, isNot)).toBe(false)
    expect([...changedListFields(is, isNot)]).toEqual(['filters'])
    expect(defsEqual(isNot, def({ ...emptyPredicate(), statusIds: [2], negate: { statusIds: true } }))).toBe(true)
  })

  it('a switch on a field that does not filter is no change', () => {
    expect(defsEqual(def(emptyPredicate()), def({ ...emptyPredicate(), negate: { tags: true } }))).toBe(true)
  })
})

describe('filter store', () => {
  beforeEach(() => useFilterStore.getState().clearAll())

  it('switches a field between is and is not, keeping its ticks', () => {
    const s = useFilterStore.getState()
    s.setStatusIds(new Set([2]))
    useFilterStore.getState().setNegated('statusIds', true)
    expect(useFilterStore.getState().filters).toMatchObject({ statusIds: new Set([2]), negate: { statusIds: true } })
    expect(useFilterStore.getState().isActive).toBe(true)
    // Ticks keep the switch.
    useFilterStore.getState().setStatusIds(new Set([2, 0]))
    expect(useFilterStore.getState().filters.negate).toEqual({ statusIds: true })
    useFilterStore.getState().setNegated('statusIds', false)
    expect(useFilterStore.getState().filters.statusIds).toEqual(new Set([2, 0]))
    expect(useFilterStore.getState().filters.negate).toBeUndefined()
  })

  it('an "is not" with nothing left ticked is no filter', () => {
    useFilterStore.getState().setPersonIds(new Set([1]))
    useFilterStore.getState().setNegated('personIds', true)
    useFilterStore.getState().setPersonIds(new Set())
    expect(useFilterStore.getState().filters.personIds).toBeNull()
    expect(useFilterStore.getState().filters.negate).toBeUndefined()
    expect(useFilterStore.getState().isActive).toBe(false)
  })

  it('a switch with nothing ticked is not kept; clear all drops every switch', () => {
    useFilterStore.getState().setNegated('tags', true)
    expect(useFilterStore.getState().filters.negate).toBeUndefined()
    useFilterStore.getState().setAllFilters(crit({ tags: new Set([1]), negate: { tags: true } }))
    expect(useFilterStore.getState().filters.negate).toEqual({ tags: true })
    useFilterStore.getState().clearAll()
    expect(useFilterStore.getState().filters.negate).toBeUndefined()
  })
})

describe('lists', () => {
  it('a prompt pick replaces the field as "is", dropping the list\'s switch on it', () => {
    const p: TodoPredicate = { ...emptyPredicate(), personIds: [1], statusIds: [2], negate: { personIds: true, statusIds: true } }
    expect(applyRuntimeFilter(p, { field: 'person' }, [2])).toEqual({ ...emptyPredicate(), personIds: [2], statusIds: [2], negate: { statusIds: true } })
    expect(applyRuntimeFilter(p, { field: 'person' }, [])).toBe(p)
  })

  it('grouped by people, an "is not" list shows the other people\'s groups', () => {
    const evaluate = createPredicateEvaluator(lookups, today, currentFilterSettings())
    const list = buildList({
      id: 1, name: 'Not Ann', sortOrder: 0, sort: 'manual', grouping: 'people',
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), personIds: [1], negate: { personIds: true } } },
    }, todos, { today, weekStartsOn: 1, evalPredicate: evaluate, people: [ann, bob], assignedPeopleMap: people, assignedTagsMap: tags })
    expect(list.sections.map((s) => [s.key, s.todos.map((t) => t.id)])).toEqual([['person-2', [2]], ['unassigned', [4]]])
  })
})
