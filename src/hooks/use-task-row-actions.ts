import { useCallback } from 'react'
import type { PersistedTodoItem } from '../models'
import { useBulkActions } from './use-bulk-actions'
import type { ContextMenuItem } from '../models/context-menu'
import { useSettingsStore } from '../stores/settings-store'
import { startOfToday } from '../utils/date'
import { isEffectivelyUrgent } from '../utils/urgency'

interface BuildMenuItemsOpts {
  todo: PersistedTodoItem
  /**
   * Whether the task counts as urgent (flagged, or due within the Settings
   * range): the Urgent item then turns Urgent off.
   */
  urgentOn: boolean
  /** Turns Urgent on (flag) / off (may ask about the due date), per `urgentOn`. */
  onToggleUrgent: () => void
  /** Flags the task (or the selection) important / clears it, per `todo.important`. */
  onToggleImportant: () => void
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
  todo, urgentOn, onToggleUrgent, onToggleImportant, onToggleFocus,
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
      label: urgentOn ? 'Remove urgent' : 'Mark urgent',
      action: onToggleUrgent,
    },
    {
      label: todo.important ? 'Remove important' : 'Mark important',
      action: onToggleImportant,
    },
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
 * product decision. A ghosted task is still a real task
 * the user can complete or delete.
 */
export function useTaskRowActions({ todo }: UseTaskRowActionsOpts) {
  const bulk = useBulkActions()
  const range = useSettingsStore((s) => s.urgentDueWithinDays)
  const urgentOn = isEffectivelyUrgent(todo, startOfToday(), range)

  const handleToggleComplete = useCallback(() => {
    bulk.toggleComplete(todo.id)
  }, [bulk, todo.id])

  const handleToggleUrgent = useCallback(() => {
    bulk.setUrgent(todo.id, !urgentOn)
  }, [bulk, todo.id, urgentOn])

  const handleToggleImportant = useCallback(() => {
    bulk.setImportant(todo.id, todo.important !== true)
  }, [bulk, todo.id, todo.important])

  const handleToggleFocus = useCallback(() => {
    bulk.setFocus(todo.id, todo.focus !== true)
  }, [bulk, todo.id, todo.focus])

  const handleDelete = useCallback(() => {
    bulk.remove(todo.id)
  }, [bulk, todo.id])

  return {
    bulk, urgentOn,
    handleToggleComplete, handleToggleUrgent, handleToggleImportant, handleToggleFocus, handleDelete,
  }
}
