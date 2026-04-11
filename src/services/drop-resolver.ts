import type { PersistedTodoItem } from '../models'
import type { PlacementTarget } from './task-placement'
import { getFlatVisualOrder } from '../utils/hierarchy'

// --- Types ---

export type DropResolution =
  | { type: 'place'; target: PlacementTarget; taskId: number }
  | { type: 'place-multi'; target: PlacementTarget; taskIds: Set<number> }
  | { type: 'indent'; taskIds: Set<number>; projectId: number }
  | { type: 'outdent'; taskIds: Set<number>; projectId: number }
  | { type: 'create-project'; position: { x: number; y: number }; taskIds: Set<number> }
  | { type: 'noop' }

export interface DropContext {
  activeTodo: PersistedTodoItem
  overType: 'task' | 'project' | null
  overTodo: PersistedTodoItem | null
  overProjectId: number | null
  delta: { x: number; y: number }
  dragIds: Set<number> | null // null = single drag
  todosByProject: Map<number, PersistedTodoItem[]>
  /** Screen-to-flow position converter, null if no React Flow instance */
  screenToFlow: ((pos: { x: number; y: number }) => { x: number; y: number }) | null
  /** Initial rect of the active draggable */
  initialRect: { left: number; top: number } | null
  canvasId: number | null
}

export interface PreviewResult {
  insertTodoId: number | null
  insertIndentLevel: number // 0 = root, 1 = child
  insertAtEnd: boolean
  insertProjectId: number | null
  dragExpandedProjectId: number | null
}

import { INDENT_PX } from '../constants'

/** Position-based child detection: is the drag far enough right to be a child? */
function wantsChildLevel(parentId: number | undefined | null, deltaX: number): boolean {
  const currentOffset = parentId != null ? INDENT_PX : 0
  // Parent is the default; child requires clear rightward intent (6x indent distance)
  return (currentOffset + deltaX) > INDENT_PX * 3
}

function isHorizontalDrag(delta: { x: number; y: number }): boolean {
  return Math.abs(delta.x) > Math.abs(delta.y) * 2 && Math.abs(delta.y) < 20
}

// --- Drop Target Resolution ---

export function resolveDropTarget(ctx: DropContext): DropResolution {
  const { activeTodo, overType, overTodo, overProjectId, delta, dragIds, todosByProject, screenToFlow, initialRect, canvasId } = ctx

  // Multi-drag
  if (dragIds) {
    return resolveMultiDrop(ctx)
  }

  // Single drag: dropped on empty canvas
  if (overType === null) {
    const distance = Math.sqrt(delta.x ** 2 + delta.y ** 2)
    // If barely moved off the source project, place at end of list instead of creating a new project
    if (distance < 150 && activeTodo.projectId != null) {
      return {
        type: 'place',
        taskId: activeTodo.id,
        target: {
          projectId: activeTodo.projectId,
          parentId: undefined,
          beforeTodoId: null,
        },
      }
    }
    // Far enough away → create new project
    if (screenToFlow && initialRect && canvasId) {
      const dropX = initialRect.left + delta.x
      const dropY = initialRect.top + delta.y
      const flowPos = screenToFlow({ x: dropX, y: dropY })
      return {
        type: 'create-project',
        position: flowPos,
        taskIds: new Set([activeTodo.id]),
      }
    }
    return { type: 'noop' }
  }

  const targetIsChild = wantsChildLevel(activeTodo.parentId, delta.x)
  const horizontal = isHorizontalDrag(delta)

  // Dropped on a project droppable
  if (overType === 'project' && overProjectId != null) {
    const targetTodos = todosByProject.get(overProjectId) ?? []

    // Same project + position says child → indent in place
    if (overProjectId === activeTodo.projectId && targetIsChild) {
      const hasChildren = targetTodos.some(t => t.parentId === activeTodo.id)
      if (!hasChildren) {
        const parentAbove = findParentAbove(targetTodos, activeTodo.id, activeTodo.id)
        if (parentAbove) {
          return {
            type: 'place',
            taskId: activeTodo.id,
            target: {
              projectId: overProjectId,
              parentId: parentAbove.id,
              beforeTodoId: null,
            },
          }
        }
      }
    }

    // Default: move to end as root
    return {
      type: 'place',
      taskId: activeTodo.id,
      target: {
        projectId: overProjectId,
        parentId: undefined,
        beforeTodoId: null,
      },
    }
  }

  // Dropped on a task
  if (overType === 'task' && overTodo) {
    let resolvedOver = overTodo

    // Horizontal drag → lock to active task for indent
    if (horizontal && resolvedOver.projectId === activeTodo.projectId && resolvedOver.id !== activeTodo.id) {
      resolvedOver = activeTodo
    }

    // Cross-project
    if (activeTodo.projectId !== resolvedOver.projectId) {
      const targetParent = resolvedOver.parentId != null ? resolvedOver.parentId : undefined
      return {
        type: 'place',
        taskId: activeTodo.id,
        target: {
          projectId: resolvedOver.projectId!,
          parentId: targetParent,
          beforeTodoId: resolvedOver.id,
        },
      }
    }

    // Same project
    const projectTodos = todosByProject.get(activeTodo.projectId!) ?? []
    const hasChildren = projectTodos.some(t => t.parentId === activeTodo.id)

    // Determine target parent
    let targetParentId: number | undefined
    if (resolvedOver.id !== activeTodo.id && resolvedOver.parentId != null && !hasChildren) {
      targetParentId = resolvedOver.parentId
    } else if (targetIsChild && !hasChildren) {
      const refId = resolvedOver.id === activeTodo.id ? activeTodo.id : resolvedOver.id
      const parentAbove = findParentAbove(projectTodos, refId, activeTodo.id)
      if (parentAbove) targetParentId = parentAbove.id
    }

    // Self-drop — only meaningful if changing indent level
    if (resolvedOver.id === activeTodo.id) {
      if (targetParentId === (activeTodo.parentId ?? undefined)) return { type: 'noop' }

      // When promoting child → root, place after the parent's group (before next root)
      let beforeTodoId: number | null = null
      if (activeTodo.parentId != null && targetParentId === undefined) {
        const flat = getFlatVisualOrder(projectTodos)
        const parentIdx = flat.findIndex(t => t.id === activeTodo.parentId)
        for (let i = parentIdx + 1; i < flat.length; i++) {
          if (flat[i].parentId == null && flat[i].id !== activeTodo.id) {
            beforeTodoId = flat[i].id
            break
          }
        }
      }

      return {
        type: 'place',
        taskId: activeTodo.id,
        target: {
          projectId: activeTodo.projectId!,
          parentId: targetParentId,
          beforeTodoId,
        },
      }
    }

    // Different task — reorder + possibly change parent
    return {
      type: 'place',
      taskId: activeTodo.id,
      target: {
        projectId: activeTodo.projectId!,
        parentId: targetParentId,
        beforeTodoId: resolvedOver.id,
      },
    }
  }

  return { type: 'noop' }
}

function resolveMultiDrop(ctx: DropContext): DropResolution {
  const { activeTodo, overType, overTodo, overProjectId, delta, dragIds, screenToFlow, initialRect, canvasId } = ctx
  if (!dragIds) return { type: 'noop' }

  const horizontal = isHorizontalDrag(delta)

  // Same-project horizontal → indent/unindent
  if (horizontal && activeTodo.projectId != null) {
    let sameProject = false
    if (overType === 'task' && overTodo) {
      sameProject = overTodo.projectId === activeTodo.projectId
    } else if (overType === 'project' && overProjectId != null) {
      sameProject = overProjectId === activeTodo.projectId
    }

    if (sameProject) {
      const wantsChild = wantsChildLevel(activeTodo.parentId, delta.x)
      if (wantsChild && activeTodo.parentId == null) {
        return { type: 'indent', taskIds: dragIds, projectId: activeTodo.projectId }
      } else if (!wantsChild && activeTodo.parentId != null) {
        return { type: 'outdent', taskIds: dragIds, projectId: activeTodo.projectId }
      }
      return { type: 'noop' }
    }
  }

  // Determine target from over data
  let targetProjectId: number | undefined
  let beforeTodoId: number | null = null
  let targetParentId: number | undefined

  if (overType === 'project' && overProjectId != null) {
    targetProjectId = overProjectId
  } else if (overType === 'task' && overTodo) {
    targetProjectId = overTodo.projectId ?? undefined
    beforeTodoId = overTodo.id
    // Match drop target's parent level, guard against self-parenting
    if (overTodo.parentId != null && !dragIds.has(overTodo.parentId)) {
      targetParentId = overTodo.parentId
    }
  } else if (overType === null) {
    const distance = Math.sqrt(delta.x ** 2 + delta.y ** 2)
    if (distance < 150 && activeTodo.projectId != null) {
      targetProjectId = activeTodo.projectId
    } else if (screenToFlow && initialRect && canvasId) {
      const dropX = initialRect.left + delta.x
      const dropY = initialRect.top + delta.y
      const flowPos = screenToFlow({ x: dropX, y: dropY })
      return { type: 'create-project', position: flowPos, taskIds: dragIds }
    }
  }

  if (targetProjectId == null) return { type: 'noop' }

  return {
    type: 'place-multi',
    taskIds: dragIds,
    target: {
      projectId: targetProjectId,
      parentId: targetParentId,
      beforeTodoId,
    },
  }
}

// --- Drop Preview Resolution ---

export function resolveDropPreview(
  activeTodo: PersistedTodoItem,
  overType: 'task' | 'project' | null,
  overTodo: PersistedTodoItem | null,
  _overProjectId: number | null,
  delta: { x: number; y: number },
  todosByProject: Map<number, PersistedTodoItem[]>,
): Omit<PreviewResult, 'dragExpandedProjectId'> {
  if (!activeTodo) return { insertTodoId: null, insertIndentLevel: 0, insertAtEnd: false, insertProjectId: null }

  const projectTodos = activeTodo.projectId != null ? (todosByProject.get(activeTodo.projectId) ?? []) : []
  const hasOwnChildren = projectTodos.some(t => t.parentId === activeTodo.id)
  const horizontal = isHorizontalDrag(delta)

  // Lock to active on horizontal drag within same project
  let resolvedOver = overTodo
  if (horizontal && resolvedOver && resolvedOver.projectId === activeTodo.projectId && resolvedOver.id !== activeTodo.id) {
    resolvedOver = activeTodo
  }

  let targetIsChild = wantsChildLevel(activeTodo.parentId, delta.x)

  // Validate child intent
  if (targetIsChild) {
    if (hasOwnChildren) {
      targetIsChild = false
    } else {
      const flat = getFlatVisualOrder(projectTodos)
      const refId = resolvedOver && resolvedOver.id !== activeTodo.id ? resolvedOver.id : activeTodo.id
      const refIdx = flat.findIndex(t => t.id === refId)
      const hasRootAbove = refIdx > 0 && flat.slice(0, refIdx).some(t => t.parentId == null && t.id !== activeTodo.id)
      if (!hasRootAbove) targetIsChild = false
    }
  }

  // Over a project droppable — always show end-of-list indicator
  // (child indent detection only applies when hovering over a specific task)
  if (overType === 'project') {
    return { insertTodoId: null, insertIndentLevel: 0, insertAtEnd: true, insertProjectId: _overProjectId }
  }

  if (resolvedOver && activeTodo.projectId === resolvedOver.projectId) {
    const showTodoId = resolvedOver.id !== activeTodo.id ? resolvedOver.id : activeTodo.id
    const level = (resolvedOver.id !== activeTodo.id && resolvedOver.parentId != null && !hasOwnChildren)
      ? 1
      : (targetIsChild ? 1 : 0)
    return { insertTodoId: showTodoId ?? null, insertIndentLevel: level, insertAtEnd: false, insertProjectId: null }
  } else if (resolvedOver) {
    // Cross-project
    return { insertTodoId: resolvedOver.id ?? null, insertIndentLevel: 0, insertAtEnd: false, insertProjectId: null }
  }

  // No target (cursor on canvas) — show end-of-list if close to source project, else clear
  const distance = Math.sqrt(delta.x ** 2 + delta.y ** 2)
  if (distance < 150 && activeTodo.projectId != null) {
    return { insertTodoId: null, insertIndentLevel: 0, insertAtEnd: true, insertProjectId: activeTodo.projectId }
  }
  return { insertTodoId: null, insertIndentLevel: 0, insertAtEnd: false, insertProjectId: null }
}

// --- Helpers ---

/** Find nearest root task above a given task in visual order, excluding excludeId */
function findParentAbove(projectTodos: PersistedTodoItem[], refTodoId: number, excludeId: number): PersistedTodoItem | null {
  const flat = getFlatVisualOrder(projectTodos)
  const idx = flat.findIndex(t => t.id === refTodoId)
  for (let i = idx - 1; i >= 0; i--) {
    if (flat[i].parentId == null && flat[i].id !== excludeId) return flat[i]
  }
  return null
}
