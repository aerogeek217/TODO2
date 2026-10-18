import type { PersistedTodoItem } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { setUrgent } from '../../services/clear-urgent'
import type { TaskMenuHandlers } from '../task/task-menu-entries'

/**
 * The task menu's handlers for a right-clicked search result. Search rows
 * aren't part of the selection, so every action acts on just this task, and
 * the row has no due-date / follow-up / people / tag pickers, so those
 * picker items are left out (the Follow-up submenu's quick intervals stay).
 */
export function searchMenuHandlers(params: {
  todo: PersistedTodoItem
  onOpen: (todoId: number) => void
}): TaskMenuHandlers {
  const { todo, onOpen } = params
  const ids = [todo.id]
  const store = () => useTodoStore.getState()
  return {
    onOpen: () => onOpen(todo.id),
    onToggleComplete: () => { void store().toggleComplete(todo.id) },
    onSetFollowup: (date) => { void store().bulkSetFollowup(ids, date) },
    onFollowedUp: () => { void store().markFollowedUp(ids) },
    onSetMarker: (marker, on) => {
      if (marker === 'urgent') void setUrgent(ids, on)
      else if (marker === 'important') void store().bulkSetImportant(ids, on)
      else void store().bulkSetFocus(ids, on)
    },
    onDelete: () => useUIStore.getState().showBulkConfirmation('delete', ids),
  }
}
