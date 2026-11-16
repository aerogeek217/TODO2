import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useBuiltList } from '../../hooks/use-built-list'
import { emptyPredicate, type DateMatch, type PersistedTodoItem, type TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { usePersonStore } from '../../stores/person-store'
import { useTodoStore } from '../../stores/todo-store'
import { screenTaskCounts } from '../../services/task-dialog'
import type { FilterCriteria } from '../../utils/filter-criteria'
import { emptyFilterCriteria, makePerson, makeTodo } from '../helpers'

/**
 * A list's `N of M` and the top bar's counter count the same way (cr33 M3 /
 * M4): the total is the open tasks and the completed ones the filter admits,
 * never every completed task there is.
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

const listDef = (predicate: Partial<TodoPredicate> = {}): PersistedListDefinition => ({
  id: 7, name: 'Everything', sortOrder: 0, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate: { ...emptyPredicate(), ...predicate } },
})

/** The top bar's counter's total under `screen`. */
function counterTotal(screen: FilterCriteria): number {
  return screenTaskCounts({
    todos: TASKS,
    today: new Date(),
    weekStartsOn: 1 as const,
    markerSettings: { urgentRange: 3 as const },
    assignedPeopleMap: usePersonStore.getState().assignedPeopleMap,
    assignedTagsMap: new Map(),
    statuses: [],
    statusUpdatesByTodo: new Map(),
    subtasksByTodo: new Map(),
    screen,
  }).total
}

beforeEach(() => {
  useTodoStore.setState({ todos: TASKS })
  usePersonStore.setState({ people: [alice], assignedPeopleMap: new Map([[1, [alice]], [4, [alice]]]) })
})
afterEach(cleanup)

describe('a list’s counts agree with the top bar’s counter', () => {
  it('a chip Completed range: the completed tasks in the range count, `1 of 4`, as the counter’s total', () => {
    const chips: FilterCriteria = { ...emptyFilterCriteria, dates: { completed: thisWeek } }
    const { result } = renderHook(() => useBuiltList(listDef(), undefined, chips))
    expect(result.current.list?.todos.map((t) => t.id)).toEqual([4])
    // 3 open + task 4, not the 5 completed last year.
    expect(result.current.baseCount).toBe(4)
    expect(counterTotal(chips)).toBe(4)
  })

  it('Show completed among the chips: every completed task counts', () => {
    const chips: FilterCriteria = { ...emptyFilterCriteria, showCompleted: true, personIds: new Set([alice.id!]) }
    const { result } = renderHook(() => useBuiltList(listDef(), undefined, chips))
    expect(result.current.list?.todos.map((t) => t.id).sort()).toEqual([1, 4])
    expect(result.current.baseCount).toBe(TASKS.length)
    expect(counterTotal(chips)).toBe(TASKS.length)
  })

  it('a list of its own completed tasks keeps counting them all', () => {
    const chips: FilterCriteria = { ...emptyFilterCriteria, personIds: new Set([alice.id!]) }
    const { result } = renderHook(() => useBuiltList(listDef({ showCompleted: true }), undefined, chips))
    expect(result.current.baseCount).toBe(TASKS.length)
    expect(result.current.list?.todos.map((t) => t.id).sort()).toEqual([1, 4])
  })
})
