import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useEntityAssignmentsForTodos } from '../../hooks/use-entity-assignments-for-todos'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useTagStore } from '../../stores/tag-store'
import { makeTodo } from '../helpers'

let loadPeopleAssignments: ReturnType<typeof vi.fn>
let loadOrgAssignments: ReturnType<typeof vi.fn>
let loadTagAssignments: ReturnType<typeof vi.fn>

beforeEach(() => {
  loadPeopleAssignments = vi.fn().mockResolvedValue(undefined)
  loadOrgAssignments = vi.fn().mockResolvedValue(undefined)
  loadTagAssignments = vi.fn().mockResolvedValue(undefined)
  usePersonStore.setState({ loadAssignments: loadPeopleAssignments })
  useOrgStore.setState({ loadAssignments: loadOrgAssignments })
  useTagStore.setState({ loadAssignments: loadTagAssignments })
  useTodoStore.setState({ todosVersion: 1 })
})

afterEach(() => {
  cleanup()
})

describe('useEntityAssignmentsForTodos', () => {
  it('loads people / org / tag assignments for the visible todo ids', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 })]
    renderHook(() => useEntityAssignmentsForTodos(todos))

    expect(loadPeopleAssignments).toHaveBeenCalledWith([1, 2])
    expect(loadOrgAssignments).toHaveBeenCalledWith([1, 2])
    expect(loadTagAssignments).toHaveBeenCalledWith([1, 2])
  })

  it('skips loading when the todo set is empty', () => {
    renderHook(() => useEntityAssignmentsForTodos([]))

    expect(loadPeopleAssignments).not.toHaveBeenCalled()
    expect(loadOrgAssignments).not.toHaveBeenCalled()
    expect(loadTagAssignments).not.toHaveBeenCalled()
  })

  it('does not re-fire on identity-only todos array changes (todosVersion stable)', () => {
    const initial = [makeTodo({ id: 1 })]
    const { rerender } = renderHook(
      ({ todos }) => useEntityAssignmentsForTodos(todos),
      { initialProps: { todos: initial } },
    )
    expect(loadPeopleAssignments).toHaveBeenCalledTimes(1)

    // Recreate the array reference without changing length / version — a
    // field-edit re-render simulator. Effect should NOT re-fire.
    const fieldEdit = [{ ...initial[0]!, title: 'edited' }]
    rerender({ todos: fieldEdit })

    expect(loadPeopleAssignments).toHaveBeenCalledTimes(1)
    expect(loadOrgAssignments).toHaveBeenCalledTimes(1)
    expect(loadTagAssignments).toHaveBeenCalledTimes(1)
  })

  it('re-fires when todosVersion bumps (add / remove / restore)', () => {
    const todos = [makeTodo({ id: 1 })]
    const { rerender } = renderHook(() => useEntityAssignmentsForTodos(todos))
    expect(loadPeopleAssignments).toHaveBeenCalledTimes(1)

    useTodoStore.setState({ todosVersion: 2 })
    rerender()

    expect(loadPeopleAssignments).toHaveBeenCalledTimes(2)
    expect(loadOrgAssignments).toHaveBeenCalledTimes(2)
    expect(loadTagAssignments).toHaveBeenCalledTimes(2)
  })

  it('re-fires when the todo set length changes', () => {
    const todos1 = [makeTodo({ id: 1 })]
    const todos2 = [makeTodo({ id: 1 }), makeTodo({ id: 2 })]
    const { rerender } = renderHook(
      ({ todos }) => useEntityAssignmentsForTodos(todos),
      { initialProps: { todos: todos1 } },
    )
    expect(loadPeopleAssignments).toHaveBeenCalledTimes(1)

    rerender({ todos: todos2 })

    expect(loadPeopleAssignments).toHaveBeenCalledTimes(2)
    expect(loadPeopleAssignments).toHaveBeenLastCalledWith([1, 2])
  })
})
