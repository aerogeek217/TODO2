import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useBuiltList, type LensProbe } from '../../hooks/use-built-list'
import { emptyPredicate, type DateMatch, type PersistedTodoItem, type TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { usePersonStore } from '../../stores/person-store'
import { useTodoStore } from '../../stores/todo-store'
import { lensHideCounts } from '../../services/lenses'
import { screenTaskCounts } from '../../services/task-dialog'
import type { FilterCriteria } from '../../utils/filter-criteria'
import { withLens, type Lens } from '../../utils/lens'
import { emptyFilterCriteria, makePerson, makeTodo } from '../helpers'

/**
 * A list's `N of M`, its lens switch's `−N` and the top bar's counter count
 * the same way (cr33 M3 / M4): the total is the open tasks and the completed
 * ones the filter admits, never every completed task there is; what the lens
 * hides is open tasks only, the lens picker's number.
 */

const daysAgo = (n: number): Date => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}

const alice = makePerson({ id: 1, name: 'Alice' })

// 3 open (1 Alice's), 1 completed today (Alice's), 5 completed last year.
const TASKS: PersistedTodoItem[] = [
  makeTodo({ id: 1 }),
  makeTodo({ id: 2 }),
  makeTodo({ id: 3 }),
  makeTodo({ id: 4, isCompleted: true, completedAt: daysAgo(0) }),
  ...[5, 6, 7, 8, 9].map((id) => makeTodo({ id, isCompleted: true, completedAt: daysAgo(400) })),
]

const thisWeek: DateMatch = { match: 'range', start: { kind: 'offset', days: -6 }, end: { kind: 'offset', days: 0 } }
const lensOf = (id: string, predicate: Partial<TodoPredicate>): Lens => ({ id, name: id, predicate: { ...emptyPredicate(), ...predicate } })
const DONE_WEEK = lensOf('done-week', { dates: { completed: thisWeek } })
const ALICE_LENS = lensOf('alice', { personIds: [alice.id!] })

const listDef = (predicate: Partial<TodoPredicate> = {}): PersistedListDefinition => ({
  id: 7, name: 'Everything', sortOrder: 0, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate: { ...emptyPredicate(), ...predicate } },
})

/** The screen filter and probe a list applying the lens gets (`useListScreenFilter`). */
function screenFor(chips: FilterCriteria | undefined, lens: Lens): { filters: FilterCriteria; probe: LensProbe } {
  const lensed = withLens(chips ?? emptyFilterCriteria, lens)
  return { filters: lensed, probe: { chips, lensed } }
}

function counter(screen: FilterCriteria, lens: Lens) {
  const env = {
    todos: TASKS,
    today: new Date(),
    weekStartsOn: 1 as const,
    markerSettings: { urgentRange: 3 as const },
    assignedPeopleMap: usePersonStore.getState().assignedPeopleMap,
    assignedTagsMap: new Map(),
    people: [alice],
    statuses: [],
    statusUpdatesByTodo: new Map(),
    subtasksByTodo: new Map(),
  }
  const counts = screenTaskCounts({ ...env, screen })
  return { total: counts.total, hides: counts.total - counts.lensKeeps, picker: lensHideCounts(env, [lens]).hides.get(lens.id) }
}

beforeEach(() => {
  useTodoStore.setState({ todos: TASKS })
  usePersonStore.setState({ people: [alice], assignedPeopleMap: new Map([[1, [alice]], [4, [alice]]]) })
})
afterEach(cleanup)

describe('a list’s counts agree with the top bar’s counter', () => {
  it('a lens with its own Completed range: `1 of 4` and `−3`, as the counter’s `1 of 4` and "hides 3"', () => {
    const { filters, probe } = screenFor(undefined, DONE_WEEK)
    const { result } = renderHook(() => useBuiltList(listDef(), undefined, filters, undefined, probe))
    expect(result.current.list?.todos.map((t) => t.id)).toEqual([4])
    expect(result.current.baseCount).toBe(4)
    expect(result.current.lensHides).toBe(3)
    expect(counter(filters, DONE_WEEK)).toEqual({ total: 4, hides: 3, picker: 3 })
  })

  it('the same lens on a list that ignores it: the list counts its own tasks, the switch what the lens would hide', () => {
    const probe: LensProbe = { chips: undefined, lensed: withLens(emptyFilterCriteria, DONE_WEEK) }
    const { result } = renderHook(() => useBuiltList(listDef(), undefined, undefined, undefined, probe))
    expect(result.current.list?.todos.map((t) => t.id)).toEqual([1, 2, 3])
    expect(result.current.baseCount).toBe(3)
    expect(result.current.lensHides).toBe(3)
  })

  it('a chip Completed range under a lens: the completed tasks in the range count, the lens hides open tasks only', () => {
    const chips: FilterCriteria = { ...emptyFilterCriteria, dates: { completed: thisWeek } }
    const { filters, probe } = screenFor(chips, ALICE_LENS)
    const { result } = renderHook(() => useBuiltList(listDef(), undefined, filters, undefined, probe))
    expect(result.current.list?.todos.map((t) => t.id)).toEqual([4])
    // 3 open + task 4, not the 5 completed last year.
    expect(result.current.baseCount).toBe(4)
    // The chips keep no open task here, so the lens hides none of the list's.
    expect(result.current.lensHides).toBe(0)
    // The counter's "hides" is of every open task, whatever the chips: Alice has one of three.
    expect(counter(filters, ALICE_LENS)).toEqual({ total: 4, hides: 2, picker: 2 })
  })

  it('Show completed among the chips: every completed task counts, the lens still hides open tasks only', () => {
    const chips: FilterCriteria = { ...emptyFilterCriteria, showCompleted: true }
    const { filters, probe } = screenFor(chips, ALICE_LENS)
    const { result } = renderHook(() => useBuiltList(listDef(), undefined, filters, undefined, probe))
    expect(result.current.list?.todos.map((t) => t.id).sort()).toEqual([1, 4])
    expect(result.current.baseCount).toBe(TASKS.length)
    expect(result.current.lensHides).toBe(2)
    expect(counter(filters, ALICE_LENS)).toEqual({ total: TASKS.length, hides: 2, picker: 2 })
  })

  it('a list of its own completed tasks keeps counting them all', () => {
    const { filters, probe } = screenFor(undefined, ALICE_LENS)
    const { result } = renderHook(() => useBuiltList(listDef({ showCompleted: true }), undefined, filters, undefined, probe))
    expect(result.current.baseCount).toBe(TASKS.length)
    expect(result.current.list?.todos.map((t) => t.id).sort()).toEqual([1, 4])
    expect(result.current.lensHides).toBe(2)
  })
})
