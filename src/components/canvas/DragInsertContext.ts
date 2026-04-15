import { createContext } from 'react'

/**
 * Stable per-drag state: changes only on drag start/end/over, not on every
 * pointer-move tick. Kept in its own context so consumers that don't need the
 * rapidly-changing preview fields (ProjectNode, CanvasView) are not re-rendered
 * by every mousemove during a drag.
 */
export interface DragInsertState {
  activeDragTodoId: number | null
  dragExpandedProjectId: number | null
  /** IDs of tasks being dragged along (children/multi-select) — disabled as drop targets */
  dragGroupIds: Set<number> | null
}

export const DragInsertContext = createContext<DragInsertState>({
  activeDragTodoId: null,
  dragExpandedProjectId: null,
  dragGroupIds: null,
})

/**
 * Rapid preview state updated on every drag-move tick. Consumed only by
 * SortableTaskList to place the green indicator / end-of-list drop marker.
 */
export interface DragPreviewState {
  insertTodoId: number | null
  insertIndentLevel: number  // 0 = root, 1 = child
  insertAtEnd: boolean       // show end-of-list drop indicator
  insertProjectId: number | null // which project the end-of-list indicator belongs to
}

export const DragPreviewContext = createContext<DragPreviewState>({
  insertTodoId: null,
  insertIndentLevel: 0,
  insertAtEnd: false,
  insertProjectId: null,
})
