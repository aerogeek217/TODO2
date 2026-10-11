import { useCallback } from 'react'
import type { PersistedTodoItem } from '../models'
import { useBulkActions } from './use-bulk-actions'
import type { ContextMenuItem } from '../models/context-menu'

interface BuildMenuItemsOpts {
  todo: PersistedTodoItem
  /** Adds the task (or the selection) to Focus / removes it, per `todo.focus`. */
  onToggleFocus: () => void
  onOpenDetail?: (todoId: number) => void
  /** Opens the follow-up popover ("Set follow-up…"). Omitted on surfaces without one. */
  onSetFollowup?: () => void
  /** "Followed up": last = now, next = today + the default interval. */
  onFollowedUp?: () => void
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
  todo, onToggleFocus,
  onOpenDetail, onSetFollowup, onFollowedUp,
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
    ...(onSetFollowup ? [{
      label: 'Set follow-up…',
      action: onSetFollowup,
    }] : []),
    ...(onFollowedUp ? [{
      label: 'Followed up',
      action: onFollowedUp,
    }] : []),
    {
      label: todo.focus ? 'Remove from Focus' : 'Add to Focus',
      action: onToggleFocus,
    },
    { label: '', action: () => {}, separator: true },
    {
      label: 'Delete',
      action: onDelete,
      danger: true,
    },
  ]
}

interface UseTaskRowActionsOpts {
  todo: PersistedTodoItem
}

/**
 * Bulk-aware row actions shared by `TaskRow` + `MobileTaskRow`. Routes single
 * vs multi-select through `useBulkActions` (which expands to the current
 * selection when relevant).
 *
 * Ghost rows (filtered-out tasks still rendered for context) are NOT gated
 * here — same right-click menu / same actions as a non-ghost row, per the
 * triage-2026-04-27-batch2 P1 decision. A ghosted task is still a real task
 * the user can complete or delete.
 */
export function useTaskRowActions({ todo }: UseTaskRowActionsOpts) {
  const bulk = useBulkActions()

  const handleToggleComplete = useCallback(() => {
    bulk.toggleComplete(todo.id)
  }, [bulk, todo.id])

  const handleToggleFocus = useCallback(() => {
    bulk.setFocus(todo.id, todo.focus !== true)
  }, [bulk, todo.id, todo.focus])

  const handleDelete = useCallback(() => {
    bulk.remove(todo.id)
  }, [bulk, todo.id])

  return { bulk, handleToggleComplete, handleToggleFocus, handleDelete }
}
