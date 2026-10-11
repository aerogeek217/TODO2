import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem, Person, Project, Status, Tag } from '../../models'
import {
  composeScreenFilter,
  createScreenComposedEvaluator,
  matchesComposedFilter,
  predicateToCriteria,
  type FilterCriteria,
} from '../../stores/filter-store'
import { emptyPredicate } from '../../stores/list-definition-store'
import type { TodoNameLookups } from '../../utils/filter'
import { makeTodo } from '../helpers'

// The screen (top-bar) filter composed with a list's own filter: narrowing
// clauses AND strictly (even on the same field); showCompleted ORs.

const today = new Date(2026, 9, 14)
const day = (m: number, d: number) => new Date(2026, m - 1, d)

const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
const work: Tag = { id: 1, name: 'work' }
const home: Tag = { id: 2, name: 'home' }
const doing: Status = { id: 1, name: 'Doing', color: '#0a0', sortOrder: 0 }
const waiting: Status = { id: 2, name: 'Waiting', color: '#aa0', sortOrder: 1 }
const alpha: Project = { id: 1, name: 'Alpha', sortOrder: 0, canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, createdAt: day(1, 1) }
const beta: Project = { id: 2, name: 'Beta', sortOrder: 1, canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, createdAt: day(1, 1) }

/**
 * One task per combination that matters: each pairs two values of a field so
 * same-field strict AND is observable.
 */
const todos: PersistedTodoItem[] = [
  makeTodo({ id: 1, title: 'Alice only', statusId: 1, projectId: 1, dueDate: day(10, 10) }),
  makeTodo({ id: 2, title: 'Bob only', statusId: 2, projectId: 2, dueDate: day(10, 20), nextFollowupAt: day(10, 16), focus: true }),
  makeTodo({ id: 3, title: 'Alice and Bob', statusId: 1, dueDate: day(10, 15), focus: true }),
  makeTodo({ id: 4, title: 'Nobody', nextFollowupAt: day(10, 30) }),
  makeTodo({ id: 5, title: 'Alice done', isCompleted: true, statusId: 1, projectId: 1, dueDate: day(10, 12) }),
  makeTodo({ id: 6, title: 'Nobody done', isCompleted: true }),
]

const lookups: TodoNameLookups = {
  assignedPeopleMap: new Map([[1, [alice]], [2, [bob]], [3, [alice, bob]], [5, [alice]]]),
  assignedTagsMap: new Map([[1, [work]], [2, [home]], [3, [work, home]], [5, [work]]]),
  statusesById: new Map([[1, doing], [2, waiting]]),
  projectsById: new Map([[1, alpha], [2, beta]]),
}

const none = (): FilterCriteria => predicateToCriteria(emptyPredicate())
const crit = (patch: Partial<FilterCriteria>): FilterCriteria => ({ ...none(), ...patch })

function ids(screen: FilterCriteria, list: FilterCriteria): number[] {
  return todos.filter((t) => matchesComposedFilter(screen, list, t, lookups, today)).map((t) => t.id)
}

/** Same as `ids`, through the evaluator list widgets use (stored predicate). */
function evaluatorIds(screen: FilterCriteria, list: FilterCriteria): number[] {
  const evaluate = createScreenComposedEvaluator(screen, lookups, today)
  const predicate = {
    ...emptyPredicate(),
    showCompleted: list.showCompleted,
    personIds: list.personIds ? [...list.personIds] : null,
    projectIds: list.projectIds ? [...list.projectIds] : null,
    statusIds: list.statusIds ? [...list.statusIds] : null,
    tags: list.tags ? [...list.tags] : null,
    searchText: list.searchText,
    dateField: list.dateField,
    dateRangeStart: list.dateRangeStart,
    dateRangeEnd: list.dateRangeEnd,
    dateRangeIncludeNoDate: list.dateRangeIncludeNoDate,
    hasDeadline: list.hasDeadline,
    hasFollowup: list.hasFollowup,
    focus: list.focus,
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
  { name: 'project', a: { projectIds: new Set([1]) }, b: { projectIds: new Set([1, 0]) }, onlyA: [1], onlyB: [1, 3, 4], both: [1] },
  { name: 'search', a: { searchText: 'alice' }, b: { searchText: 'bob' }, onlyA: [1, 3], onlyB: [2, 3], both: [3] },
  { name: 'search by status name', a: { searchText: 'doing' }, b: { searchText: 'only' }, onlyA: [1, 3], onlyB: [1, 2], both: [1] },
  {
    name: 'due range',
    a: { dateField: 'deadline', dateRangeStart: fixed(day(10, 1)), dateRangeEnd: fixed(day(10, 15)) },
    b: { dateField: 'deadline', dateRangeStart: fixed(day(10, 14)), dateRangeEnd: null },
    onlyA: [1, 3], onlyB: [2, 3], both: [3],
  },
  {
    name: 'due range vs follow-up range (different date fields)',
    a: { dateField: 'deadline', dateRangeStart: fixed(day(10, 1)), dateRangeEnd: fixed(day(10, 31)) },
    b: { dateField: 'followup', dateRangeStart: fixed(day(10, 1)), dateRangeEnd: fixed(day(10, 31)) },
    onlyA: [1, 2, 3], onlyB: [2, 4], both: [2],
  },
  { name: 'has due date', a: { hasDeadline: true }, b: { hasDeadline: false }, onlyA: [1, 2, 3], onlyB: [4], both: [] },
  { name: 'has follow-up', a: { hasFollowup: true }, b: { hasDeadline: true }, onlyA: [2, 4], onlyB: [1, 2, 3], both: [2] },
  { name: 'focus', a: { focus: true }, b: { focus: false }, onlyA: [2, 3], onlyB: [1, 4], both: [] },
  { name: 'focus with people', a: { focus: true }, b: { personIds: new Set([1]) }, onlyA: [2, 3], onlyB: [1, 3], both: [3] },
]

describe('composeScreenFilter', () => {
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
    expect(ids(crit({ searchText: 'only' }), crit({ hasFollowup: true }))).toEqual([2])
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
