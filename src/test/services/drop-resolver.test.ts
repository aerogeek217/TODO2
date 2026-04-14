import { describe, it, expect } from 'vitest'
import { resolveDropTarget, resolveDropPreview } from '../../services/drop-resolver'
import type { DropContext } from '../../services/drop-resolver'
import { makeTodo } from '../helpers'

// INDENT_PX = 24, so wantsChildLevel threshold = 24 * 3 = 72
// For root (parentId undefined): currentOffset=0, need deltaX > 72
// For child (parentId set): currentOffset=24, need deltaX > 48
// isHorizontalDrag: abs(x) > abs(y)*2 AND abs(y) < 20

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
      delta: { x: 50, y: 50 }, // distance ~70 < 150
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 10, parentId: undefined, beforeTodoId: null },
    })
  })

  it('dropped on null, long distance with screenToFlow → create-project', () => {
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: null,
      delta: { x: 200, y: 200 }, // distance > 150
      screenToFlow: (pos) => ({ x: pos.x + 100, y: pos.y + 100 }),
      initialRect: { left: 50, top: 50 },
      canvasId: 1,
    }))
    expect(result.type).toBe('create-project')
    if (result.type === 'create-project') {
      expect(result.taskIds).toEqual(new Set([1]))
      // dropX = 50+200=250, dropY=50+200=250, screenToFlow adds 100
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

  it('dropped on project, cross-project → place at end as root', () => {
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: 'project',
      overProjectId: 20,
      delta: { x: 0, y: 0 },
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 20, parentId: undefined, beforeTodoId: null },
    })
  })

  it('dropped on same project + child intent + no children + parent above → place under parent', () => {
    const parent = makeTodo({ id: 2, projectId: 10, sortOrder: 1 })
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 2 })
    const todosByProject = new Map([[10, [parent, active]]])

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'project',
      overProjectId: 10,
      delta: { x: 80, y: 0 }, // root: deltaX=80 > 72 → wantsChild
      todosByProject,
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 10, parentId: 2, beforeTodoId: null },
    })
  })

  it('dropped on same project + child intent but has children → place as root (fallback)', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const child = makeTodo({ id: 3, projectId: 10, parentId: 1, sortOrder: 2 })
    const todosByProject = new Map([[10, [active, child]]])

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'project',
      overProjectId: 10,
      delta: { x: 80, y: 0 },
      todosByProject,
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 10, parentId: undefined, beforeTodoId: null },
    })
  })

  it('dropped on same project + child intent but no parent above → place as root', () => {
    // active is the first/only root task, no root above it
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const todosByProject = new Map([[10, [active]]])

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'project',
      overProjectId: 10,
      delta: { x: 80, y: 0 },
      todosByProject,
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 10, parentId: undefined, beforeTodoId: null },
    })
  })

  it('dropped on task, cross-project → place before target with target parentId', () => {
    const active = makeTodo({ id: 1, projectId: 10 })
    const overTodo = makeTodo({ id: 5, projectId: 20, parentId: 4 })

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo,
      delta: { x: 0, y: 30 },
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 20, parentId: 4, beforeTodoId: 5 },
    })
  })

  it('dropped on task, cross-project, target is root → parentId undefined', () => {
    const active = makeTodo({ id: 1, projectId: 10 })
    const overTodo = makeTodo({ id: 5, projectId: 20 }) // no parentId

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo,
      delta: { x: 0, y: 30 },
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 20, parentId: undefined, beforeTodoId: 5 },
    })
  })

  it('dropped on task, horizontal drag locks resolvedOver to activeTodo', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const overTodo = makeTodo({ id: 2, projectId: 10, sortOrder: 2 })
    const todosByProject = new Map([[10, [active, overTodo]]])

    // Horizontal drag: abs(x)=100 > abs(y)*2=10, abs(y)=5 < 20
    // Since resolvedOver becomes activeTodo and same indent → noop (self-drop, same parent)
    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo,
      delta: { x: 100, y: 5 },
      todosByProject,
    }))
    // resolvedOver = activeTodo, same parentId → noop
    expect(result).toEqual({ type: 'noop' })
  })

  it('dropped on task, same project, different task → reorder with beforeTodoId', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const target = makeTodo({ id: 2, projectId: 10, sortOrder: 2 })
    const todosByProject = new Map([[10, [active, target]]])

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo: target,
      delta: { x: 0, y: 50 }, // not horizontal
      todosByProject,
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 10, parentId: undefined, beforeTodoId: 2 },
    })
  })

  it('dropped on task, self-drop same indent → noop', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const todosByProject = new Map([[10, [active]]])

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo: active,
      delta: { x: 0, y: 5 }, // not horizontal
      todosByProject,
    }))
    expect(result).toEqual({ type: 'noop' })
  })

  it('self-drop promoting child→root → beforeTodoId is next root', () => {
    const parent = makeTodo({ id: 2, projectId: 10, sortOrder: 1 })
    const active = makeTodo({ id: 1, projectId: 10, parentId: 2, sortOrder: 2 })
    const nextRoot = makeTodo({ id: 3, projectId: 10, sortOrder: 3 })
    const todosByProject = new Map([[10, [parent, active, nextRoot]]])

    // Self-drop: overTodo = activeTodo, not horizontal, delta.x small so no child intent
    // activeTodo.parentId=2, targetParentId=undefined → promoting
    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo: active,
      delta: { x: 0, y: 5 },
      todosByProject,
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 10, parentId: undefined, beforeTodoId: 3 },
    })
  })

  it('self-drop demoting root→child → parentId set', () => {
    const parentAbove = makeTodo({ id: 2, projectId: 10, sortOrder: 1 })
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 2 })
    const todosByProject = new Map([[10, [parentAbove, active]]])

    // Self-drop with child intent: deltaX=80 > 72 for root
    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo: active,
      delta: { x: 80, y: 5 }, // not horizontal (abs(5)*2=10 < 80), not strictly horizontal
      todosByProject,
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 10, parentId: 2, beforeTodoId: null },
    })
  })

  it('dropped on task over child target, adopts target parentId', () => {
    const parent = makeTodo({ id: 2, projectId: 10, sortOrder: 1 })
    const child = makeTodo({ id: 3, projectId: 10, parentId: 2, sortOrder: 2 })
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 3 })
    const todosByProject = new Map([[10, [parent, child, active]]])

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo: child,
      delta: { x: 0, y: 50 },
      todosByProject,
    }))
    expect(result).toEqual({
      type: 'place',
      taskId: 1,
      target: { projectId: 10, parentId: 2, beforeTodoId: 3 },
    })
  })
})

// ─── resolveMultiDrop ──────────────────────────────────────────────

describe('resolveMultiDrop (via resolveDropTarget with dragIds)', () => {
  it('horizontal same-project, root + wants child → indent', () => {
    const active = makeTodo({ id: 1, projectId: 10 })
    const overTodo = makeTodo({ id: 2, projectId: 10 })
    const dragIds = new Set([1, 2])

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo,
      delta: { x: 100, y: 5 }, // horizontal, deltaX=100>72 for root
      dragIds,
    }))
    expect(result).toEqual({ type: 'indent', taskIds: dragIds, projectId: 10 })
  })

  it('horizontal same-project, child + wants root → outdent', () => {
    const active = makeTodo({ id: 1, projectId: 10, parentId: 5 })
    const overTodo = makeTodo({ id: 2, projectId: 10 })
    const dragIds = new Set([1, 2])

    // child: currentOffset=24, deltaX=11, 24+11=35 < 36 → does NOT want child → outdent
    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo,
      delta: { x: 11, y: 5 }, // horizontal
      dragIds,
    }))
    expect(result).toEqual({ type: 'outdent', taskIds: dragIds, projectId: 10 })
  })

  it('horizontal same-project, already at target level → noop', () => {
    // Root task, delta not enough to want child: stays root → noop
    const active = makeTodo({ id: 1, projectId: 10 })
    const overTodo = makeTodo({ id: 2, projectId: 10 })
    const dragIds = new Set([1, 2])

    const result = resolveDropTarget(makeCtx({
      activeTodo: active,
      overType: 'task',
      overTodo,
      delta: { x: 30, y: 5 }, // horizontal, deltaX=30 < 72 → doesn't want child, already root
      dragIds,
    }))
    expect(result).toEqual({ type: 'noop' })
  })

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
      target: { projectId: 20, parentId: undefined, beforeTodoId: null },
    })
  })

  it('over task → place-multi before target, respects parentId', () => {
    const overTodo = makeTodo({ id: 5, projectId: 20, parentId: 4 })
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
      target: { projectId: 20, parentId: 4, beforeTodoId: 5 },
    })
  })

  it('over task → guards self-parent (parentId in dragIds)', () => {
    // overTodo.parentId is in dragIds → should NOT set targetParentId
    const overTodo = makeTodo({ id: 5, projectId: 20, parentId: 1 })
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
      target: { projectId: 20, parentId: undefined, beforeTodoId: 5 },
    })
  })

  it('over null, short distance → place-multi in source project', () => {
    const dragIds = new Set([1, 2])
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: null,
      delta: { x: 50, y: 50 }, // distance ~70 < 150
      dragIds,
    }))
    expect(result).toEqual({
      type: 'place-multi',
      taskIds: dragIds,
      target: { projectId: 10, parentId: undefined, beforeTodoId: null },
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

  it('horizontal drag with over project (same project), root wants child → indent', () => {
    const dragIds = new Set([1, 2])
    const result = resolveDropTarget(makeCtx({
      activeTodo: makeTodo({ id: 1, projectId: 10 }),
      overType: 'project',
      overProjectId: 10,
      delta: { x: 100, y: 5 }, // horizontal, wantsChild
      dragIds,
    }))
    expect(result).toEqual({ type: 'indent', taskIds: dragIds, projectId: 10 })
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
      insertIndentLevel: 0,
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
      insertIndentLevel: 0,
      insertAtEnd: true,
      insertProjectId: 20,
    })
  })

  it('same project same task → correct indent level 0 (no child intent)', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const todosByProject = new Map([[10, [active]]])

    const result = resolveDropPreview(
      active,
      'task',
      active,
      null,
      { x: 0, y: 5 },
      todosByProject,
    )
    expect(result).toEqual({
      insertTodoId: 1,
      insertIndentLevel: 0,
      insertAtEnd: false,
      insertProjectId: null,
    })
  })

  it('same project, different task at root → indent level 0', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const target = makeTodo({ id: 2, projectId: 10, sortOrder: 2 })
    const todosByProject = new Map([[10, [active, target]]])

    const result = resolveDropPreview(
      active,
      'task',
      target,
      null,
      { x: 0, y: 50 },
      todosByProject,
    )
    expect(result).toEqual({
      insertTodoId: 2,
      insertIndentLevel: 0,
      insertAtEnd: false,
      insertProjectId: null,
    })
  })

  it('same project, over child target (no own children) → indent level 1', () => {
    const parent = makeTodo({ id: 2, projectId: 10, sortOrder: 1 })
    const child = makeTodo({ id: 3, projectId: 10, parentId: 2, sortOrder: 2 })
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 3 })
    const todosByProject = new Map([[10, [parent, child, active]]])

    const result = resolveDropPreview(
      active,
      'task',
      child,
      null,
      { x: 0, y: 50 },
      todosByProject,
    )
    expect(result).toEqual({
      insertTodoId: 3,
      insertIndentLevel: 1,
      insertAtEnd: false,
      insertProjectId: null,
    })
  })

  it('cross-project → indent level 0', () => {
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
      insertIndentLevel: 0,
      insertAtEnd: false,
      insertProjectId: null,
    })
  })

  it('child intent blocked by own children → indent level 0', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const ownChild = makeTodo({ id: 3, projectId: 10, parentId: 1, sortOrder: 2 })
    const other = makeTodo({ id: 2, projectId: 10, sortOrder: 3 })
    const todosByProject = new Map([[10, [active, ownChild, other]]])

    const result = resolveDropPreview(
      active,
      'task',
      active,
      null,
      { x: 80, y: 5 }, // would want child, but has own children
      todosByProject,
    )
    expect(result).toEqual({
      insertTodoId: 1,
      insertIndentLevel: 0,
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
      { x: 50, y: 50 }, // distance ~70 < 150
      new Map(),
    )
    expect(result).toEqual({
      insertTodoId: null,
      insertIndentLevel: 0,
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
      { x: 200, y: 200 }, // distance > 150
      new Map(),
    )
    expect(result).toEqual({
      insertTodoId: null,
      insertIndentLevel: 0,
      insertAtEnd: false,
      insertProjectId: null,
    })
  })

  it('horizontal drag same project locks resolvedOver to activeTodo', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const other = makeTodo({ id: 2, projectId: 10, sortOrder: 2 })
    const todosByProject = new Map([[10, [active, other]]])

    // horizontal: abs(100) > abs(5)*2, abs(5) < 20
    // resolvedOver becomes activeTodo, so insertTodoId=1
    const result = resolveDropPreview(
      active,
      'task',
      other,
      null,
      { x: 100, y: 5 },
      todosByProject,
    )
    expect(result.insertTodoId).toBe(1)
  })

  it('child intent with no root above → forced to level 0', () => {
    // Only task is active itself, no root above
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const todosByProject = new Map([[10, [active]]])

    const result = resolveDropPreview(
      active,
      'task',
      active,
      null,
      { x: 80, y: 5 }, // wants child, but no root above
      todosByProject,
    )
    expect(result.insertIndentLevel).toBe(0)
  })

  it('hovering over own child → no preview (self-group)', () => {
    const active = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const ownChild = makeTodo({ id: 3, projectId: 10, parentId: 1, sortOrder: 2 })
    const todosByProject = new Map([[10, [active, ownChild]]])

    const result = resolveDropPreview(
      active,
      'task',
      ownChild,
      null,
      { x: 0, y: 50 },
      todosByProject,
    )
    expect(result).toEqual({
      insertTodoId: null,
      insertIndentLevel: 0,
      insertAtEnd: false,
      insertProjectId: null,
    })
  })
})

// ─── resolveMultiDrop — parent+children drag ─────────────────────────

describe('resolveMultiDrop — parent+children drag', () => {
  it('dropped on own group member → noop', () => {
    const parent = makeTodo({ id: 1, projectId: 10, sortOrder: 1 })
    const child = makeTodo({ id: 3, projectId: 10, parentId: 1, sortOrder: 2 })
    const other = makeTodo({ id: 2, projectId: 10, sortOrder: 3 })
    const dragIds = new Set([1, 3])
    const todosByProject = new Map([[10, [parent, child, other]]])

    const result = resolveDropTarget(makeCtx({
      activeTodo: parent,
      overType: 'task',
      overTodo: child,
      delta: { x: 0, y: 50 },
      dragIds,
      todosByProject,
    }))
    expect(result).toEqual({ type: 'noop' })
  })

  it('group with internal hierarchy prevents child-level nesting', () => {
    const parentQ = makeTodo({ id: 10, projectId: 100, sortOrder: 1 })
    const childQ = makeTodo({ id: 11, projectId: 100, parentId: 10, sortOrder: 2 })
    const parent = makeTodo({ id: 1, projectId: 100, sortOrder: 3 })
    const child = makeTodo({ id: 2, projectId: 100, parentId: 1, sortOrder: 4 })
    const rootAfter = makeTodo({ id: 20, projectId: 100, sortOrder: 5 })
    const dragIds = new Set([1, 2])
    const todosByProject = new Map([[100, [parentQ, childQ, parent, child, rootAfter]]])

    // Drop parent+child group onto childQ (child of parentQ)
    const result = resolveDropTarget(makeCtx({
      activeTodo: parent,
      overType: 'task',
      overTodo: childQ,
      delta: { x: 0, y: 50 },
      dragIds,
      todosByProject,
    }))
    // Should place at root level, not nested under parentQ
    expect(result.type).toBe('place-multi')
    if (result.type === 'place-multi') {
      expect(result.target.parentId).toBeUndefined()
      // beforeTodoId should resolve to the next root after childQ (skipping drag group members)
      expect(result.target.beforeTodoId).toBe(20)
    }
  })

  it('group with internal hierarchy — no root after target → append at end', () => {
    const parentQ = makeTodo({ id: 10, projectId: 100, sortOrder: 1 })
    const childQ = makeTodo({ id: 11, projectId: 100, parentId: 10, sortOrder: 2 })
    const parent = makeTodo({ id: 1, projectId: 100, sortOrder: 3 })
    const child = makeTodo({ id: 2, projectId: 100, parentId: 1, sortOrder: 4 })
    const dragIds = new Set([1, 2])
    const todosByProject = new Map([[100, [parentQ, childQ, parent, child]]])

    const result = resolveDropTarget(makeCtx({
      activeTodo: parent,
      overType: 'task',
      overTodo: childQ,
      delta: { x: 0, y: 50 },
      dragIds,
      todosByProject,
    }))
    expect(result.type).toBe('place-multi')
    if (result.type === 'place-multi') {
      expect(result.target.parentId).toBeUndefined()
      expect(result.target.beforeTodoId).toBeNull()
    }
  })

  it('group without internal hierarchy still allows child-level nesting', () => {
    // Multi-select of two independent root tasks (no parent-child within group)
    const parentQ = makeTodo({ id: 10, projectId: 100, sortOrder: 1 })
    const childQ = makeTodo({ id: 11, projectId: 100, parentId: 10, sortOrder: 2 })
    const taskA = makeTodo({ id: 1, projectId: 100, sortOrder: 3 })
    const taskB = makeTodo({ id: 2, projectId: 100, sortOrder: 4 })
    const dragIds = new Set([1, 2])
    const todosByProject = new Map([[100, [parentQ, childQ, taskA, taskB]]])

    const result = resolveDropTarget(makeCtx({
      activeTodo: taskA,
      overType: 'task',
      overTodo: childQ,
      delta: { x: 0, y: 50 },
      dragIds,
      todosByProject,
    }))
    expect(result.type).toBe('place-multi')
    if (result.type === 'place-multi') {
      expect(result.target.parentId).toBe(10) // adopts parentQ as parent
      expect(result.target.beforeTodoId).toBe(11)
    }
  })
})
