import type { PersistedTodoItem } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { buildTaskRowMenuItems } from '../../hooks/use-task-row-actions'
import type { ContextMenuItem } from '../../models/context-menu'
import { setUrgent } from '../../services/clear-urgent'
import { useSettingsStore } from '../../stores/settings-store'
import { startOfToday } from '../../utils/date'
import { isEffectivelyUrgent } from '../../utils/urgency'

/**
 * Build the context-menu items shown when a search result is right-clicked.
 *
 * Mirrors the items on `TaskRow`'s menu by delegating to the shared
 * `buildTaskRowMenuItems` helper. Search-specific overrides:
 *  - Complete: hits `useTodoStore.toggleComplete` directly (search rows are
 *    not part of the multi-select), bypassing the bulk-actions expansion.
 *  - Delete: queues a single-id bulk confirmation (same — no selection
 *    expansion).
 *  - Followed up / Urgent / Important / Focus: act on just this task (same
 *    reason).
 */
export function buildSearchContextMenuItems(params: {
  todo: PersistedTodoItem
  onOpen: (todoId: number) => void
}): ContextMenuItem[] {
  const { todo, onOpen } = params
  const urgentOn = isEffectivelyUrgent(todo, startOfToday(), useSettingsStore.getState().urgentDueWithinDays)
  return buildTaskRowMenuItems({
    todo,
    urgentOn,
    onToggleUrgent: () => { void setUrgent([todo.id], !urgentOn) },
    onToggleImportant: () => { void useTodoStore.getState().bulkSetImportant([todo.id], todo.important !== true) },
    onToggleFocus: () => { void useTodoStore.getState().bulkSetFocus([todo.id], todo.focus !== true) },
    onOpenDetail: onOpen,
    onFollowedUp: () => { void useTodoStore.getState().markFollowedUp([todo.id]) },
    onComplete: () => { void useTodoStore.getState().toggleComplete(todo.id) },
    onDelete: () => useUIStore.getState().showBulkConfirmation('delete', [todo.id]),
  })
}
