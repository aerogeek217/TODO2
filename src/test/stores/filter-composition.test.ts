import { describe, it, expect, beforeEach } from 'vitest'
import type { PersistedTodoItem, Person, Status, Tag } from '../../models'
import { composeScreenFilter, predicateToCriteria, type FilterCriteria } from '../../utils/filter-criteria'
import { createScreenComposedEvaluator, matchesComposedFilter } from '../../utils/filter-match'
import { emptyPredicate } from '../../models'
import type { TodoNameLookups } from '../../utils/filter'
import { makeTodo } from '../helpers'
import { currentFilterSettings, useSettingsStore } from '../../stores/settings-store'
import { DEFAULT_HOT_RULE } from '../../utils/hot'

// The screen (top-bar) filter composed with a list's own filter: narrowing
// clauses AND strictly (even on the same field); showCompleted ORs.

const today = new Date(2026, 9, 14)
const day = (m: number, d: number) => new Date(2026, m - 1, d)

const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
const work: Tag = { id: 1, name: 'work', color: '#36c' }
const home: Tag = { id: 2, name: 'home', color: '#c84' }
const doing: Status = { id: 1, name: 'Doing', color: '#0a0', sortOrder: 0 }
const waiting: Status = { id: 2, name: 'Waiting', color: '#aa0', sortOrder: 1 }

/**
 * One task per combination that matters: each pairs two values of a field so
 * same-field strict AND is observable.
 */
const todos: PersistedTodoItem[] = [
  makeTodo({ id: 1, title: 'Alice only', statusId: 1, dueDate: day(10, 10) }),
  makeTodo({ id: 2, title: 'Bob only', statusId: 2, dueDate: day(10, 20), nextFollowupAt: day(10, 16), focus: true, urgent: true }),
  makeTodo({ id: 3, title: 'Alice and Bob', statusId: 1, dueDate: day(10, 15), focus: true }),
  makeTodo({ id: 4, title: 'Nobody', nextFollowupAt: day(10, 30), important: true }),
  makeTodo({ id: 5, title: 'Alice done', isCompleted: true, statusId: 1, dueDate: day(10, 12) }),
  makeTodo({ id: 6, title: 'Nobody done', isCompleted: true }),
]

const lookups: TodoNameLookups = {
  assignedPeopleMap: new Map([[1, [alice]], [2, [bob]], [3, [alice, bob]], [5, [alice]]]),
  assignedTagsMap: new Map([[1, [work]], [2, [home]], [3, [work, home]], [5, [work]]]),
  statusesById: new Map([[1, doing], [2, waiting]]),
}

const none = (): FilterCriteria => predicateToCriteria(emptyPredicate())
const crit = (patch: Partial<FilterCriteria>): FilterCriteria => ({ ...none(), ...patch })

function ids(screen: FilterCriteria, list: FilterCriteria): number[] {
  return todos.filter((t) => matchesComposedFilter(screen, list, t, lookups, today, currentFilterSettings())).map((t) => t.id)
}

/** Same as `ids`, through the evaluator list widgets use (stored predicate). */
function evaluatorIds(screen: FilterCriteria, list: FilterCriteria): number[] {
  const evaluate = createScreenComposedEvaluator(screen, lookups, today, currentFilterSettings())
  const predicate = {
    ...emptyPredicate(),
    showCompleted: list.showCompleted,
    personIds: list.personIds ? [...list.personIds] : null,
    statusIds: list.statusIds ? [...list.statusIds] : null,
    tags: list.tags ? [...list.tags] : null,
    searchText: list.searchText,
    dates: list.dates,
    markers: list.markers,
  }
  return todos.filter((t) => evaluate(predicate, t)).map((t) => t.id)
}

const fixed = (d: Date) => ({ kind: 'fixed' as const, iso: d.toISOString() })

/**
 * Per narrowing field: two values `a` / `b`, the open tasks each keeps on its
 * own, and the open tasks that satisfy both (strict AND).
 */
const fields: Array<{ name: string; a: Partial<FilterCriteria>; b: Partial<FilterCriteria>; onlyA: number[]; onlyB: number[]; both: number[] }> = [
  { name: 'people', a: { personIds: new Set([1]) }, b: { personIds: new Set([2]) }, onlyA: [1, 3], onlyB: [2, 3], both: [3] },
  { name: 'people incl. unassigned', a: { personIds: new Set([0]) }, b: { personIds: new Set([0, 2]) }, onlyA: [4], onlyB: [2, 3, 4], both: [4] },
  { name: 'tags', a: { tags: new Set([1]) }, b: { tags: new Set([2]) }, onlyA: [1, 3], onlyB: [2, 3], both: [3] },
  { name: 'status', a: { statusIds: new Set([1]) }, b: { statusIds: new Set([1, 2]) }, onlyA: [1, 3], onlyB: [1, 2, 3], both: [1, 3] },
  { name: 'status none vs set', a: { statusIds: new Set([0]) }, b: { statusIds: new Set([2]) }, onlyA: [4], onlyB: [2], both: [] },
  { name: 'tags overlapping', a: { tags: new Set([1]) }, b: { tags: new Set([1, 2]) }, onlyA: [1, 3], onlyB: [1, 2, 3], both: [1, 3] },
  { name: 'search', a: { searchText: 'alice' }, b: { searchText: 'bob' }, onlyA: [1, 3], onlyB: [2, 3], both: [3] },
  { name: 'search by tag name', a: { searchText: 'work' }, b: { searchText: 'home' }, onlyA: [1, 3], onlyB: [2, 3], both: [3] },
  { name: 'search by status name', a: { searchText: 'doing' }, b: { searchText: 'only' }, onlyA: [1, 3], onlyB: [1, 2], both: [1] },
  {
    name: 'due range',
    a: { dates: { deadline: { match: 'range', start: fixed(day(10, 1)), end: fixed(day(10, 15)) } } },
    b: { dates: { deadline: { match: 'range', start: fixed(day(10, 14)), end: null } } },
    onlyA: [1, 3], onlyB: [2, 3], both: [3],
  },
  {
    name: 'due range vs follow-up range (different date fields)',
    a: { dates: { deadline: { match: 'range', start: fixed(day(10, 1)), end: fixed(day(10, 31)) } } },
    b: { dates: { followup: { match: 'range', start: fixed(day(10, 1)), end: fixed(day(10, 31)) } } },
    onlyA: [1, 2, 3], onlyB: [2, 4], both: [2],
  },
  { name: 'has due date', a: { dates: { deadline: { match: 'set' } } }, b: { dates: { deadline: { match: 'unset' } } }, onlyA: [1, 2, 3], onlyB: [4], both: [] },
  { name: 'has follow-up', a: { dates: { followup: { match: 'set' } } }, b: { dates: { deadline: { match: 'set' } } }, onlyA: [2, 4], onlyB: [1, 2, 3], both: [2] },
  { name: 'markers', a: { markers: { focus: true } }, b: { markers: { important: true } }, onlyA: [2, 3], onlyB: [4], both: [] },
  // Urgent = flagged (2) or due within 3 days, overdue included (1, 3).
  { name: 'urgent marker with focus', a: { markers: { urgent: true } }, b: { markers: { focus: true } }, onlyA: [1, 2, 3], onlyB: [2, 3], both: [2, 3] },
  { name: 'markers with people', a: { markers: { focus: true } }, b: { personIds: new Set([1]) }, onlyA: [2, 3], onlyB: [1, 3], both: [3] },
  // Hot (default rule: Urgent AND Important, or Focus) = 2, 3.
  { name: 'hot with urgent', a: { markers: 'hot' }, b: { markers: { urgent: true } }, onlyA: [2, 3], onlyB: [1, 2, 3], both: [2, 3] },
  { name: 'hot with important', a: { markers: 'hot' }, b: { markers: { important: true } }, onlyA: [2, 3], onlyB: [4], both: [] },
  { name: 'hot with people', a: { markers: 'hot' }, b: { personIds: new Set([1]) }, onlyA: [2, 3], onlyB: [1, 3], both: [3] },
]

describe('composeScreenFilter', () => {
  beforeEach(() => {
    useSettingsStore.setState({ urgentDueWithinDays: 3, hotRule: DEFAULT_HOT_RULE })
  })

  it('Hot follows the Settings rule on both sides', () => {
    useSettingsStore.setState({ hotRule: [{ important: true }, { urgent: true, focus: true }] })
    // 3 is in Focus and urgent by its due date (day after tomorrow).
    expect(ids(crit({ markers: 'hot' }), none())).toEqual([2, 3, 4])
    expect(ids(none(), crit({ markers: 'hot' }))).toEqual([2, 3, 4])
    expect(evaluatorIds(crit({ markers: 'hot' }), crit({ markers: { important: true } }))).toEqual([4])
    useSettingsStore.setState({ urgentDueWithinDays: null })
    expect(ids(crit({ markers: 'hot' }), none())).toEqual([2, 4])
  })

  it('ORs showCompleted into both stages and leaves the other clauses alone', () => {
    const screen = crit({ personIds: new Set([1]) })
    const list = crit({ showCompleted: true, tags: new Set([2]) })
    const [s, l] = composeScreenFilter(screen, list)
    expect(s).toEqual({ ...screen, showCompleted: true })
    expect(l).toEqual(list)
    expect(screen.showCompleted).toBe(false) // inputs untouched
  })

  it('no filter on either side: every open task', () => {
    expect(ids(none(), none())).toEqual([1, 2, 3, 4])
  })

  describe.each(fields)('$name', ({ a, b, onlyA, onlyB, both }) => {
    it('narrows from the screen alone', () => {
      expect(ids(crit(a), none())).toEqual(onlyA)
      expect(ids(crit(b), none())).toEqual(onlyB)
    })

    it('narrows from the list alone', () => {
      expect(ids(none(), crit(a))).toEqual(onlyA)
      expect(ids(none(), crit(b))).toEqual(onlyB)
    })

    it('screen and list on this field AND strictly, in either order', () => {
      expect(ids(crit(a), crit(b))).toEqual(both)
      expect(ids(crit(b), crit(a))).toEqual(both)
    })

    it('the widget evaluator agrees', () => {
      expect(evaluatorIds(crit(a), crit(b))).toEqual(both)
      expect(evaluatorIds(none(), crit(a))).toEqual(onlyA)
      expect(evaluatorIds(crit(b), none())).toEqual(onlyB)
    })
  })

  it('different fields AND across screen and list', () => {
    expect(ids(crit({ personIds: new Set([1]) }), crit({ statusIds: new Set([1]) }))).toEqual([1, 3])
    expect(ids(crit({ tags: new Set([2]) }), crit({ personIds: new Set([1]) }))).toEqual([3])
    expect(ids(crit({ searchText: 'only' }), crit({ dates: { followup: { match: 'set' } } }))).toEqual([2])
  })

  describe('showCompleted ORs', () => {
    it.each([
      [false, false, [1, 2, 3, 4]],
      [true, false, [1, 2, 3, 4, 5, 6]],
      [false, true, [1, 2, 3, 4, 5, 6]],
      [true, true, [1, 2, 3, 4, 5, 6]],
    ])('screen %s, list %s', (screenShows, listShows, expected) => {
      expect(ids(crit({ showCompleted: screenShows }), crit({ showCompleted: listShows }))).toEqual(expected)
      expect(evaluatorIds(crit({ showCompleted: screenShows }), crit({ showCompleted: listShows }))).toEqual(expected)
    })

    it('completed tasks shown by one side still pass the other side’s narrowing', () => {
      // Screen shows completed + Alice; list narrows on work.
      expect(ids(crit({ showCompleted: true, personIds: new Set([1]) }), crit({ tags: new Set([1]) }))).toEqual([1, 3, 5])
      // List shows completed; the screen's tag filter still applies to them.
      expect(ids(crit({ tags: new Set([1]) }), crit({ showCompleted: true }))).toEqual([1, 3, 5])
      // A completed task with nothing assigned is dropped by a person filter on either side.
      expect(ids(crit({ showCompleted: true }), crit({ personIds: new Set([1]) }))).toEqual([1, 3, 5])
    })
  })
})
