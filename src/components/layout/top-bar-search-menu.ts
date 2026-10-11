import type { PersistedTodoItem } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { buildTaskRowMenuItems } from '../../hooks/use-task-row-actions'
import type { ContextMenuItem } from '../../models/context-menu'

/**
 * Build the context-menu items shown when a search result is right-clicked.
 *
 * Mirrors the items on `TaskRow`'s menu by delegating to the shared
 * `buildTaskRowMenuItems` helper. Search-specific overrides:
 *  - Complete: hits `useTodoStore.toggleComplete` directly (search rows are
 *    not part of the multi-select), bypassing the bulk-actions expansion.
 *  - Delete: queues a single-id bulk confirmation (same — no selection
 *    expansion).
 *  - Followed up / Focus: act on just this task (same reason).
 */
export function buildSearchContextMenuItems(params: {
  todo: PersistedTodoItem
  onOpen: (todoId: number) => void
  onMoveToProject: () => void
}): ContextMenuItem[] {
  const { todo, onOpen, onMoveToProject } = params
  return buildTaskRowMenuItems({
    todo,
    onToggleFocus: () => { void useTodoStore.getState().bulkSetFocus([todo.id], todo.focus !== true) },
    onOpenDetail: onOpen,
    onMoveToProject,
    onFollowedUp: () => { void useTodoStore.getState().markFollowedUp([todo.id]) },
    onComplete: () => { void useTodoStore.getState().toggleComplete(todo.id) },
    onDelete: () => useUIStore.getState().showBulkConfirmation('delete', [todo.id]),
  })
}
