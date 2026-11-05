import { useCallback } from 'react'
import type { MarkerKey, PersistedTodoItem } from '../models'
import { useTodoStore } from '../stores/todo-store'
import { useBulkActions } from './use-bulk-actions'

interface UseTaskRowActionsOpts {
  todo: PersistedTodoItem
}

/**
 * Bulk-aware row actions shared by `TaskRow` + `MobileTaskRow` (and the task
 * menu they open). Routes single
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

  // Only a row showing the task's own completion toggles it. A recurring
  // task's finished occurrence lingers shown completed while the task is
  // already open on its next date (`use-leaving-rows`, `advanced`): its tick
  // would advance the task a second time, skipping an occurrence.
  const shownCompleted = todo.isCompleted
  const handleToggleComplete = useCallback(() => {
    const stored = useTodoStore.getState().todos.find((t) => t.id === todo.id)
    if (stored && stored.isCompleted !== shownCompleted) return
    bulk.toggleComplete(todo.id)
  }, [bulk, todo.id, shownCompleted])

  /** Sets or clears a marker's flag on the task (or its selection). */
  const handleSetMarker = useCallback((marker: MarkerKey, on: boolean) => {
    if (marker === 'urgent') bulk.setUrgent(todo.id, on)
    else if (marker === 'important') bulk.setImportant(todo.id, on)
    else bulk.setFocus(todo.id, on)
  }, [bulk, todo.id])

  const handleDelete = useCallback(() => {
    bulk.remove(todo.id)
  }, [bulk, todo.id])

  return { bulk, handleToggleComplete, handleSetMarker, handleDelete }
}
