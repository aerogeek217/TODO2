import { useCallback } from 'react'
import type { PersistedTodoItem } from '../models'
import { useBulkActions } from './use-bulk-actions'
import { useTaskboardStore } from '../stores/taskboard-store'
import type { ContextMenuItem } from '../models/context-menu'

interface BuildMenuItemsOpts {
  todo: PersistedTodoItem
  onBoard: boolean
  /** When true, the row is rendered inside a Taskboard surface — terminal "Delete" becomes "Remove from Taskboard". */
  onTaskboard?: boolean
  onOpenDetail?: (todoId: number) => void
  onMoveToProject?: () => void
  onComplete: () => void
  onDelete: () => void
}

/**
 * Pure builder for the task-row context menu. Used by `TaskRow`'s right-click
 * menu, `MobileTaskRow`'s long-press menu, and the search-result context menu
 * via `buildSearchContextMenuItems`. Keeping this pure (no store reads) lets
 * tests cover the menu shape without mounting a row.
 */
export function buildTaskRowMenuItems({
  todo, onBoard, onTaskboard,
  onOpenDetail, onMoveToProject,
  onComplete, onDelete,
}: BuildMenuItemsOpts): ContextMenuItem[] {
  return [
    ...(onOpenDetail ? [{
      label: 'Open',
      action: () => onOpenDetail(todo.id),
    }] : []),
    {
      label: todo.isCompleted ? 'Mark incomplete' : 'Mark complete',
      action: onComplete,
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
    ...(onMoveToProject ? [{
      label: 'Move to project…',
      action: onMoveToProject,
    }] : []),
    { label: '', action: () => {}, separator: true },
    {
      label: onTaskboard ? 'Remove from Taskboard' : 'Delete',
      action: onDelete,
      danger: true,
    },
  ]
}

interface UseTaskRowActionsOpts {
  todo: PersistedTodoItem
  /** When true, "Delete" on this surface removes the todo from the Taskboard instead of deleting it. */
  onTaskboard?: boolean
}

/**
 * Bulk-aware row actions shared by `TaskRow` + `MobileTaskRow`. Routes single
 * vs multi-select through `useBulkActions` (which expands to the current
 * selection when relevant); on a Taskboard surface, delete becomes
 * `removeEntry` instead of a destructive delete confirmation.
 *
 * Ghost rows (filtered-out tasks still rendered for context) are NOT gated
 * here — same right-click menu / same actions as a non-ghost row, per the
 * triage-2026-04-27-batch2 P1 decision. A ghosted task is still a real task
 * the user can complete or delete.
 */
export function useTaskRowActions({ todo, onTaskboard }: UseTaskRowActionsOpts) {
  const bulk = useBulkActions()

  const handleToggleComplete = useCallback(() => {
    bulk.toggleComplete(todo.id)
  }, [bulk, todo.id])

  const handleDelete = useCallback(() => {
    if (onTaskboard) {
      void useTaskboardStore.getState().removeEntry(todo.id)
      return
    }
    bulk.remove(todo.id)
  }, [bulk, todo.id, onTaskboard])

  return { bulk, handleToggleComplete, handleDelete }
}
