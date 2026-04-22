import { describe, it, expect } from 'vitest'
import { resolveDropTarget, resolveDropPreview } from '../../services/drop-resolver'
import type { DropContext } from '../../services/drop-resolver'
import { makeTodo } from '../helpers'

function makeCtx(overrides: Partial<DropContext>): DropContext {
  return {
    activeTodo: makeTodo({ id: 1, projectId: 10 }),
    overType: null,
    overTodo: null,
    overProjectId: null,
    delta: { x: 0, y: 0 },
    dragIds: null,
    todosByProject: new Map(),
    screenToFlow: null,
    initialRect: null,
    canvasId: null,
    ...overrides,
  }
}

// ─── resolveDropTarget — single drag ───────────────────────────────

describe('resolveDropTarget — single drag', () => {
  it('dropped on null (canvas), short distance → place at end of source project', () => {
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: null,
      delta: { x: 50, y: 50 },
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 10, beforeTodoId: null },
    })
  })

  it('dropped on null, long distance with screenToFlow → create-project', () => {
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: null,
      delta: { x: 200, y: 200 },
      screenToFlow: (pos) => ({ x: pos.x + 100, y: pos.y + 100 }),
      initialRect: { left: 50, top: 50 },
      canvasId: 1,
    }))
    expect(result.type).toBe('create-project')
    if (result.type === 'create-project') {
      expect(result.taskIds).toEqual(new Set([1]))
      expect(result.position).toEqual({ x: 350, y: 350 })
    }
  })

  it('dropped on null, long distance without screenToFlow → noop', () => {
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: null,
      delta: { x: 200, y: 200 },
      screenToFlow: null,
    }))
    expect(result).toEqual({ type: 'noop' })
  })

  it('dropped on project, cross-project → place at end', () => {
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: 'project',
      overProjectId: 20,
      delta: { x: 0, y: 0 },
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 20, beforeTodoId: null },
    })
  })

  it('dropped on task, cross-project → place before target', () => {
    const active = makeTodo({ id: 1, projectId: 10 })
    const overTodo = makeTodo({ id: 5, projectId: 20 })

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo,
      delta: { x: 0, y: 30 },
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 20, beforeTodoId: 5 },
    })
  })

  it('dropped on task, same project, different task → reorder with beforeTodoId', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const target = makeTodo({ id: 2, projectId: 10, sortOrder: 2 })

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo: target,
      delta: { x: 0, y: 50 },
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 10, beforeTodoId: 2 },
    })
  })

  it('dropped on task, self-drop → noop', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo: active,
      delta: { x: 0, y: 5 },
    }))
    expect(result).toEqual({ type: 'noop' })
  })
})

// ─── resolveMultiDrop ──────────────────────────────────────────────

describe('resolveMultiDrop (via resolveDropTarget with dragIds)', () => {
  it('over project → place-multi at end', () => {
    const dragIds = new Set([1, 2])
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: 'project',
      overProjectId: 20,
      delta: { x: 0, y: 50 },
      dragIds,
    }))
    expect(result).toEqual({
      type: 'place-multi',
      taskIds: dragIds,
      target: { projectId: 20, beforeTodoId: null },
    })
  })

  it('over task → place-multi before target', () => {
    const overTodo = makeTodo({ id: 5, projectId: 20 })
    const dragIds = new Set([1, 2])

    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: 'task',
      overTodo,
      delta: { x: 0, y: 50 },
      dragIds,
    }))
    expect(result).toEqual({
      type: 'place-multi',
      taskIds: dragIds,
      target: { projectId: 20, beforeTodoId: 5 },
    })
  })

  it('over a member of the drag group → noop', () => {
    const overTodo = makeTodo({ id: 2, projectId: 10 })
    const dragIds = new Set([1, 2])

    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: 'task',
      overTodo,
      delta: { x: 0, y: 50 },
      dragIds,
    }))
    expect(result).toEqual({ type: 'noop' })
  })

  it('over null, short distance → place-multi in source project', () => {
    const dragIds = new Set([1, 2])
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: null,
      delta: { x: 50, y: 50 },
      dragIds,
    }))
    expect(result).toEqual({
      type: 'place-multi',
      taskIds: dragIds,
      target: { projectId: 10, beforeTodoId: null },
    })
  })

  it('over null, long distance with screenToFlow → create-project', () => {
    const dragIds = new Set([1, 2])
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: null,
      delta: { x: 200, y: 200 },
      dragIds,
      screenToFlow: (pos) => pos,
      initialRect: { left: 10, top: 10 },
      canvasId: 1,
    }))
    expect(result.type).toBe('create-project')
    if (result.type === 'create-project') {
      expect(result.taskIds).toEqual(dragIds)
    }
  })

  it('no valid target (null, long distance, no screenToFlow) → noop', () => {
    const dragIds = new Set([1, 2])
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: null,
      delta: { x: 200, y: 200 },
      dragIds,
      screenToFlow: null,
    }))
    expect(result).toEqual({ type: 'noop' })
  })
})

// ─── resolveDropPreview ────────────────────────────────────────────

describe('resolveDropPreview', () => {
  it('falsy activeTodo → defaults', () => {
    const result = resolveDropPreview(
      null as unknown as any,
      null,
      null,
      null,
      { x: 0, y: 0 },
      new Map(),
    )
    expect(result).toEqual({
      insertTodoId: null,
      insertAtEnd: false,
      insertProjectId: null,
    })
  })

  it('over project → end-of-list indicator', () => {
    const active = makeTodo({ id: 1, projectId: 10 })
    const result = resolveDropPreview(
      active,
      'project',
      null,
      20,
      { x: 0, y: 0 },
      new Map(),
    )
    expect(result).toEqual({
      insertTodoId: null,
      insertAtEnd: true,
      insertProjectId: 20,
    })
  })

  it('over task same project → insertTodoId = target id', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const target = makeTodo({ id: 2, projectId: 10, sortOrder: 2 })

    const result = resolveDropPreview(
      active,
      'task',
      target,
      null,
      { x: 0, y: 50 },
      new Map(),
    )
    expect(result).toEqual({
      insertTodoId: 2,
      insertAtEnd: false,
      insertProjectId: null,
    })
  })

  it('over task cross-project → insertTodoId = target id', () => {
    const active = makeTodo({ id: 1, projectId: 10 })
    const overTodo = makeTodo({ id: 5, projectId: 20 })

    const result = resolveDropPreview(
      active,
      'task',
      overTodo,
      null,
      { x: 0, y: 50 },
      new Map(),
    )
    expect(result).toEqual({
      insertTodoId: 5,
      insertAtEnd: false,
      insertProjectId: null,
    })
  })

  it('no target, close distance → end-of-list for source project', () => {
    const active = makeTodo({ id: 1, projectId: 10 })

    const result = resolveDropPreview(
      active,
      null,
      null,
      null,
      { x: 50, y: 50 },
      new Map(),
    )
    expect(result).toEqual({
      insertTodoId: null,
      insertAtEnd: true,
      insertProjectId: 10,
    })
  })

  it('no target, far distance → clear all indicators', () => {
    const active = makeTodo({ id: 1, projectId: 10 })

    const result = resolveDropPreview(
      active,
      null,
      null,
      null,
      { x: 200, y: 200 },
      new Map(),
    )
    expect(result).toEqual({
      insertTodoId: null,
      insertAtEnd: false,
      insertProjectId: null,
    })
  })
})
