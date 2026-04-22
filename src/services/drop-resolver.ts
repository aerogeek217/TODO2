import type { PersistedTodoItem } from '../models'
import type { PlacementTarget } from './task-placement'

// --- Types ---

export type DropResolution =
  | { type: 'place'; target: PlacementTarget; taskId: number }
  | { type: 'place-multi'; target: PlacementTarget; taskIds: Set<number> }
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
  insertIndentLevel: number
  insertAtEnd: boolean
  insertProjectId: number | null
  dragExpandedProjectId: number | null
}

// --- Drop Target Resolution ---

export function resolveDropTarget(ctx: DropContext): DropResolution {
  const { activeTodo, overType, overTodo, overProjectId, delta, dragIds, screenToFlow, initialRect, canvasId } = ctx

  if (dragIds) {
    return resolveMultiDrop(ctx)
  }

  // Dropped on empty canvas
  if (overType === null) {
    const distance = Math.sqrt(delta.x ** 2 + delta.y ** 2)
    if (distance < 150 && activeTodo.projectId != null) {
      return {
        type: 'place',
        taskId: activeTodo.id,
        target: { projectId: activeTodo.projectId, beforeTodoId: null },
      }
    }
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

  if (overType === 'project' && overProjectId != null) {
    return {
      type: 'place',
      taskId: activeTodo.id,
      target: { projectId: overProjectId, beforeTodoId: null },
    }
  }

  if (overType === 'task' && overTodo) {
    // Self-drop → noop
    if (overTodo.id === activeTodo.id) {
      return { type: 'noop' }
    }
    const targetProjectId = overTodo.projectId ?? activeTodo.projectId
    if (targetProjectId == null) return { type: 'noop' }
    return {
      type: 'place',
      taskId: activeTodo.id,
      target: { projectId: targetProjectId, beforeTodoId: overTodo.id },
    }
  }

  return { type: 'noop' }
}

function resolveMultiDrop(ctx: DropContext): DropResolution {
  const { activeTodo, overType, overTodo, overProjectId, delta, dragIds, screenToFlow, initialRect, canvasId } = ctx
  if (!dragIds) return { type: 'noop' }

  // Dropped on a member of the drag group → noop
  if (overType === 'task' && overTodo && dragIds.has(overTodo.id)) {
    return { type: 'noop' }
  }

  let targetProjectId: number | undefined
  let beforeTodoId: number | null = null

  if (overType === 'project' && overProjectId != null) {
    targetProjectId = overProjectId
  } else if (overType === 'task' && overTodo) {
    targetProjectId = overTodo.projectId ?? undefined
    beforeTodoId = overTodo.id
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
    target: { projectId: targetProjectId, beforeTodoId },
  }
}

// --- Drop Preview Resolution ---

export function resolveDropPreview(
  activeTodo: PersistedTodoItem,
  overType: 'task' | 'project' | null,
  overTodo: PersistedTodoItem | null,
  overProjectId: number | null,
  delta: { x: number; y: number },
  _todosByProject: Map<number, PersistedTodoItem[]>,
): Omit<PreviewResult, 'dragExpandedProjectId'> {
  if (!activeTodo) {
    return { insertTodoId: null, insertIndentLevel: 0, insertAtEnd: false, insertProjectId: null }
  }

  if (overType === 'project') {
    return { insertTodoId: null, insertIndentLevel: 0, insertAtEnd: true, insertProjectId: overProjectId }
  }

  if (overTodo) {
    return { insertTodoId: overTodo.id, insertIndentLevel: 0, insertAtEnd: false, insertProjectId: null }
  }

  const distance = Math.sqrt(delta.x ** 2 + delta.y ** 2)
  if (distance < 150 && activeTodo.projectId != null) {
    return { insertTodoId: null, insertIndentLevel: 0, insertAtEnd: true, insertProjectId: activeTodo.projectId }
  }
  return { insertTodoId: null, insertIndentLevel: 0, insertAtEnd: false, insertProjectId: null }
}
