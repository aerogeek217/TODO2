import { useCallback } from 'react'
import type { MarkerKey, PersistedTodoItem } from '../models'
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

  const handleToggleComplete = useCallback(() => {
    bulk.toggleComplete(todo.id)
  }, [bulk, todo.id])

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
