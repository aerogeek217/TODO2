import type { PersistedTodoItem } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { buildTaskRowMenuItems } from '../../hooks/use-task-row-actions'
import type { ContextMenuItem } from '../overlays/CanvasContextMenu'

/**
 * Build the context-menu items shown when a search result is right-clicked —
 * P4 of `docs/plans/features/features-batch-2026-04`.
 *
 * Mirrors the items on `TaskRow`'s menu by delegating to the shared
 * `buildTaskRowMenuItems` helper. Search-specific overrides:
 *  - Complete: hits `useTodoStore.toggleComplete` directly (search rows are
 *    not part of the multi-select), bypassing the bulk-actions expansion.
 *  - Delete: queues a single-id bulk confirmation (same — no selection
 *    expansion).
 */
export function buildSearchContextMenuItems(params: {
  todo: PersistedTodoItem
  onBoard: boolean
  onOpen: (todoId: number) => void
  onMoveToProject: () => void
}): ContextMenuItem[] {
  const { todo, onBoard, onOpen, onMoveToProject } = params
  return buildTaskRowMenuItems({
    todo,
    onBoard,
    onOpenDetail: onOpen,
    onMoveToProject,
    onComplete: () => { void useTodoStore.getState().toggleComplete(todo.id) },
    onDelete: () => useUIStore.getState().showBulkConfirmation('delete', [todo.id]),
  })
}
