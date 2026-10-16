import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup, act } from '@testing-library/react'
import { useEntityAssignmentsForLoadedTodos } from '../../hooks/use-entity-assignments-for-todos'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { makeTodo } from '../helpers'

let loadPeopleAssignments: ReturnType<typeof vi.fn>
let loadTagAssignments: ReturnType<typeof vi.fn>

beforeEach(() => {
  loadPeopleAssignments = vi.fn().mockResolvedValue(undefined)
  loadTagAssignments = vi.fn().mockResolvedValue(undefined)
  usePersonStore.setState({ loadAssignments: loadPeopleAssignments })
  useTagStore.setState({ loadAssignments: loadTagAssignments })
  useTodoStore.setState({ todos: [], todosVersion: 1 })
})

afterEach(() => {
  cleanup()
})

describe('useEntityAssignmentsForLoadedTodos', () => {
  it('loads people / tag assignments for the loaded todo ids', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1 }), makeTodo({ id: 2 })] })
    renderHook(() => useEntityAssignmentsForLoadedTodos())

    expect(loadPeopleAssignments).toHaveBeenCalledWith([1, 2])
    expect(loadTagAssignments).toHaveBeenCalledWith([1, 2])
  })

  it('skips loading when no task is loaded', () => {
    renderHook(() => useEntityAssignmentsForLoadedTodos())

    expect(loadPeopleAssignments).not.toHaveBeenCalled()
    expect(loadTagAssignments).not.toHaveBeenCalled()
  })

  it('neither re-fires nor re-renders on a task edit (todosVersion and count stable)', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1 })] })
    let renders = 0
    renderHook(() => { renders++; useEntityAssignmentsForLoadedTodos() })
    expect(loadPeopleAssignments).toHaveBeenCalledTimes(1)
    const rendered = renders

    act(() => useTodoStore.setState({ todos: [{ ...useTodoStore.getState().todos[0]!, title: 'edited' }] }))

    expect(renders).toBe(rendered)
    expect(loadPeopleAssignments).toHaveBeenCalledTimes(1)
    expect(loadTagAssignments).toHaveBeenCalledTimes(1)
  })

  it('re-fires when todosVersion bumps (add / remove / restore)', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1 })] })
    renderHook(() => useEntityAssignmentsForLoadedTodos())
    expect(loadPeopleAssignments).toHaveBeenCalledTimes(1)

    act(() => useTodoStore.setState({ todosVersion: 2 }))

    expect(loadPeopleAssignments).toHaveBeenCalledTimes(2)
    expect(loadTagAssignments).toHaveBeenCalledTimes(2)
  })

  it('re-fires when the task count changes', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1 })] })
    renderHook(() => useEntityAssignmentsForLoadedTodos())
    expect(loadPeopleAssignments).toHaveBeenCalledTimes(1)

    act(() => useTodoStore.setState({ todos: [makeTodo({ id: 1 }), makeTodo({ id: 2 })] }))

    expect(loadPeopleAssignments).toHaveBeenCalledTimes(2)
    expect(loadPeopleAssignments).toHaveBeenLastCalledWith([1, 2])
  })
})
