import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock dnd-kit to avoid DOM-level sensor dependencies
vi.mock('@dnd-kit/core', () => ({
  useSensor: vi.fn().mockReturnValue({}),
  useSensors: vi.fn().mockReturnValue([]),
  MeasuringStrategy: { WhileDragging: 'WhileDragging' },
  PointerSensor: class {},
  // Collision algorithms imported by `buildTaskCollision` (transitively via
  // `use-canvas-dnd` → `task-dnd`). Tests exercise drop handlers directly and
  // never invoke the detection function, so simple stubs suffice.
  pointerWithin: vi.fn().mockReturnValue([]),
  closestCenter: vi.fn().mockReturnValue([]),
  rectIntersection: vi.fn().mockReturnValue([]),
}))

import { useCanvasDnD } from '../../hooks/use-canvas-dnd'
import { useUndoStore } from '../../stores/undo-store'
import { useUIStore } from '../../stores/ui-store'
import { makeTodo } from '../helpers'
import type { PersistedTodoItem } from '../../models'

// ─── Helpers ──────────────────────────────────────────────────────────

const todo1 = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
const todo2 = makeTodo({ id: 2, projectId: 10, sortOrder: 2 })

function makeOptions(overrides: Partial<Parameters<typeof useCanvasDnD>[0]> = {}) {
  return {
    todos: [todo1, todo2],
    todosByProject: new Map<number, PersistedTodoItem[]>([[10, [todo1, todo2]]]),
    projects: [],
    selectedCanvasId: 1,
    addProject: vi.fn().mockResolvedValue(99),
    applyMutations: vi.fn().mockResolvedValue(undefined),
    rfInstanceRef: { current: null },
    ...overrides,
  }
}

function makeDragStartEvent(todo: PersistedTodoItem) {
  return {
    active: {
      id: `task-${todo.id}`,
      data: { current: { todo } },
    },
    activatorEvent: { clientX: 100, clientY: 100 },
  }
}

function makeDragEndEvent(todo: PersistedTodoItem, over: unknown = null, delta = { x: 10, y: 10 }) {
  return {
    active: {
      id: `task-${todo.id}`,
      data: { current: { todo } },
      rect: { current: { initial: null, translated: null } },
    },
    over,
    delta,
  }
}

// ─── Setup ────────────────────────────────────────────────────────────

let rafId = 1

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockImplementation(() => rafId++))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  useUIStore.setState({ selectedTodoIds: new Set() })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── executeDrop — undo group safety (C1 fix) ────────────────────────

describe('useCanvasDnD — undo group safety (C1 fix)', () => {
  it('calls endGroup even when applyMutations throws', async () => {
    const applyMutations = vi.fn().mockRejectedValue(new Error('DB write failed'))
    const options = makeOptions({ applyMutations })

    // Inject mock undo functions so we can track calls without Zustand state churn
    const beginGroup = vi.fn()
    const endGroup = vi.fn()
    useUndoStore.setState({ beginGroup, endGroup })

    const { result } = renderHook(() => useCanvasDnD(options))

    // Drop todo1 with short delta and no over → resolves to 'place' at end of source project
    const event = makeDragEndEvent(todo1, null, { x: 10, y: 10 })

    try {
      await act(async () => {
        await result.current.handleDragEnd(event as any)
      })
    } catch {
      // Expected — applyMutations throws, propagates from executeDrop
    }

    expect(beginGroup).toHaveBeenCalledTimes(1)
    expect(endGroup).toHaveBeenCalledTimes(1)
    expect(endGroup).toHaveBeenCalledWith('Move task')
  })

  it('calls beginGroup and endGroup on successful drop', async () => {
    const applyMutations = vi.fn().mockResolvedValue(undefined)
    const options = makeOptions({ applyMutations })

    const beginGroup = vi.fn()
    const endGroup = vi.fn()
    useUndoStore.setState({ beginGroup, endGroup })

    const { result } = renderHook(() => useCanvasDnD(options))

    const event = makeDragEndEvent(todo1, null, { x: 10, y: 10 })

    await act(async () => {
      await result.current.handleDragEnd(event as any)
    })

    expect(beginGroup).toHaveBeenCalledTimes(1)
    expect(endGroup).toHaveBeenCalledTimes(1)
    expect(applyMutations).toHaveBeenCalled()
  })

  it('does not start undo group for noop drops (no active todo)', async () => {
    const options = makeOptions()

    const beginGroup = vi.fn()
    const endGroup = vi.fn()
    useUndoStore.setState({ beginGroup, endGroup })

    const { result } = renderHook(() => useCanvasDnD(options))

    // Event with no todo data → handleDragEnd returns early before executeDrop
    const event = {
      active: { id: 'task-99', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      over: null,
      delta: { x: 0, y: 0 },
    }

    await act(async () => {
      await result.current.handleDragEnd(event as any)
    })

    expect(beginGroup).not.toHaveBeenCalled()
    expect(endGroup).not.toHaveBeenCalled()
  })
})

// ─── handleDragStart — state management ──────────────────────────────

describe('useCanvasDnD — handleDragStart', () => {
  it('sets active drag todo for single task', () => {
    const options = makeOptions()
    const { result } = renderHook(() => useCanvasDnD(options))

    act(() => {
      result.current.handleDragStart(makeDragStartEvent(todo1) as any)
    })

    expect(result.current.activeDragTodo).toEqual(todo1)
    expect(result.current.multiDragCount).toBe(0)
  })

  it('uses selected todos for multi-drag when multiple selected', () => {
    useUIStore.setState({ selectedTodoIds: new Set([1, 2]) })

    const options = makeOptions()
    const { result } = renderHook(() => useCanvasDnD(options))

    act(() => {
      result.current.handleDragStart(makeDragStartEvent(todo1) as any)
    })

    expect(result.current.multiDragCount).toBe(2)
    expect(result.current.dragGroupIds).toEqual(new Set([2]))
  })
})

// ─── handleDragEnd — state reset ─────────────────────────────────────

describe('useCanvasDnD — handleDragEnd state reset', () => {
  it('resets all drag state after drop', async () => {
    // Use no-op undo to avoid side effects
    useUndoStore.setState({ beginGroup: vi.fn(), endGroup: vi.fn() })

    const options = makeOptions()
    const { result } = renderHook(() => useCanvasDnD(options))

    // Start drag
    act(() => {
      result.current.handleDragStart(makeDragStartEvent(todo1) as any)
    })
    expect(result.current.activeDragTodo).not.toBeNull()

    // End drag
    await act(async () => {
      await result.current.handleDragEnd(makeDragEndEvent(todo1) as any)
    })

    expect(result.current.activeDragTodo).toBeNull()
    expect(result.current.multiDragCount).toBe(0)
    expect(result.current.dragExpandedProjectId).toBeNull()
    expect(result.current.insertTodoId).toBeNull()
    expect(result.current.insertAtEnd).toBe(false)
    expect(result.current.insertProjectId).toBeNull()
    expect(result.current.dragGroupIds).toBeNull()
  })

  it('cleans up edge pan pointer listener on drag end', async () => {
    useUndoStore.setState({ beginGroup: vi.fn(), endGroup: vi.fn() })
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const options = makeOptions()
    const { result } = renderHook(() => useCanvasDnD(options))

    // Start drag (installs pointermove listener)
    act(() => {
      result.current.handleDragStart(makeDragStartEvent(todo1) as any)
    })

    // End drag (should remove pointermove listener)
    await act(async () => {
      await result.current.handleDragEnd(makeDragEndEvent(todo1) as any)
    })

    const removals = removeSpy.mock.calls.filter(([type]) => type === 'pointermove')
    expect(removals.length).toBeGreaterThan(0)
  })
})

// ─── handleDragCancel — state reset (C1 fix) ────────────────────────

describe('useCanvasDnD — handleDragCancel (C1 fix)', () => {
  it('resets all drag state on cancel', () => {
    const options = makeOptions()
    const { result } = renderHook(() => useCanvasDnD(options))

    // Start drag
    act(() => {
      result.current.handleDragStart(makeDragStartEvent(todo1) as any)
    })
    expect(result.current.activeDragTodo).not.toBeNull()

    // Cancel drag
    act(() => {
      result.current.handleDragCancel()
    })

    expect(result.current.activeDragTodo).toBeNull()
    expect(result.current.multiDragCount).toBe(0)
    expect(result.current.dragExpandedProjectId).toBeNull()
    expect(result.current.insertTodoId).toBeNull()
    expect(result.current.insertAtEnd).toBe(false)
    expect(result.current.insertProjectId).toBeNull()
    expect(result.current.dragGroupIds).toBeNull()
  })

  it('cleans up edge pan pointer listener on cancel', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const options = makeOptions()
    const { result } = renderHook(() => useCanvasDnD(options))

    // Start drag (installs pointermove listener)
    act(() => {
      result.current.handleDragStart(makeDragStartEvent(todo1) as any)
    })

    // Cancel drag (should remove pointermove listener)
    act(() => {
      result.current.handleDragCancel()
    })

    const removals = removeSpy.mock.calls.filter(([type]) => type === 'pointermove')
    expect(removals.length).toBeGreaterThan(0)
  })

  it('does not execute drop on cancel', () => {
    const applyMutations = vi.fn()
    const options = makeOptions({ applyMutations })
    const { result } = renderHook(() => useCanvasDnD(options))

    // Start drag
    act(() => {
      result.current.handleDragStart(makeDragStartEvent(todo1) as any)
    })

    // Cancel drag
    act(() => {
      result.current.handleDragCancel()
    })

    expect(applyMutations).not.toHaveBeenCalled()
  })
})

// ─── handleDragOver — project expansion ──────────────────────────────

describe('useCanvasDnD — handleDragOver', () => {
  it('sets dragExpandedProjectId when over a collapsed project', () => {
    const options = makeOptions({
      projects: [{ id: 10, name: 'P', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: true, sortOrder: 1, createdAt: new Date() }],
    })
    const { result } = renderHook(() => useCanvasDnD(options))

    act(() => {
      result.current.handleDragOver({
        active: { id: 'task-1', data: { current: { todo: todo1 } } },
        over: { id: 'project-10', data: { current: { type: 'project', projectId: 10 } } },
      } as any)
    })

    expect(result.current.dragExpandedProjectId).toBe(10)
  })

  it('clears dragExpandedProjectId when over is null', () => {
    const options = makeOptions()
    const { result } = renderHook(() => useCanvasDnD(options))

    act(() => {
      result.current.handleDragOver({
        active: { id: 'task-1', data: { current: { todo: todo1 } } },
        over: null,
      } as any)
    })

    expect(result.current.dragExpandedProjectId).toBeNull()
  })
})
