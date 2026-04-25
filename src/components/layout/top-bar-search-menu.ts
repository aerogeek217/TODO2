import type { PersistedTodoItem } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { useUIStore } from '../../stores/ui-store'
import type { ContextMenuItem } from '../overlays/CanvasContextMenu'

/**
 * Build the context-menu items shown when a search result is right-clicked —
 * P4 of `docs/plans/features/features-batch-2026-04`.
 *
 * Mirrors the items on `TaskRow`'s menu: Open / Mark (in)complete /
 * Add-or-Remove from Taskboard / Move to project… / Delete. Extracted as a
 * pure helper so unit tests can exercise each action without mounting a
 * full TopBar.
 */
export function buildSearchContextMenuItems(params: {
  todo: PersistedTodoItem
  onBoard: boolean
  onOpen: (todoId: number) => void
  onMoveToProject: () => void
}): ContextMenuItem[] {
  const { todo, onBoard, onOpen, onMoveToProject } = params
  return [
    { label: 'Open', action: () => onOpen(todo.id) },
    {
      label: todo.isCompleted ? 'Mark incomplete' : 'Mark complete',
      action: () => { void useTodoStore.getState().toggleComplete(todo.id) },
    },
    onBoard
      ? {
          label: 'Remove from Taskboard',
          action: () => { void useTaskboardStore.getState().removeEntry(todo.id) },
        }
      : {
          label: 'Add to Taskboard',
          action: () => { void useTaskboardStore.getState().add(todo.id) },
        },
    { label: 'Move to project…', action: onMoveToProject },
    { label: '', action: () => {}, separator: true },
    {
      label: 'Delete',
      action: () => useUIStore.getState().showBulkConfirmation('delete', [todo.id]),
      danger: true,
    },
  ]
}
