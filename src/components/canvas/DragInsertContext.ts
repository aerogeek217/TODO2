import { createContext } from 'react'

/** Mutable ref capturing the DragOverlay's last screen rect before it unmounts on drop. */
export const lastOverlayRect: { current: DOMRect | null } = { current: null }

export interface DragInsertState {
  insertTodoId: number | null
  insertIndentLevel: number  // 0 = root, 1 = child
  insertAtEnd: boolean       // show end-of-list drop indicator
  insertProjectId: number | null // which project the end-of-list indicator belongs to
  activeDragTodoId: number | null // the todo currently being dragged
  dragExpandedProjectId: number | null
  /** IDs of tasks being dragged along (children/multi-select) — disabled as drop targets */
  dragGroupIds: Set<number> | null
}

export const DragInsertContext = createContext<DragInsertState>({
  insertTodoId: null,
  insertIndentLevel: 0,
  insertAtEnd: false,
  insertProjectId: null,
  activeDragTodoId: null,
  dragExpandedProjectId: null,
  dragGroupIds: null,
})
