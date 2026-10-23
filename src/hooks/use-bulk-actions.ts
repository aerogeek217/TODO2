import { useCallback } from 'react'
import { useUIStore } from '../stores/ui-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'

/**
 * Returns the set of IDs to act on: all selected IDs if the target is
 * in a multi-selection, otherwise just the single target.
 */
function getTargetIds(todoId: number): number[] {
  const { selectedTodoIds } = useUIStore.getState()
  if (selectedTodoIds.size > 1 && selectedTodoIds.has(todoId)) {
    return Array.from(selectedTodoIds)
  }
  return [todoId]
}

export function useBulkActions() {
  const toggleComplete = useCallback((todoId: number) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
      if (!todo) return
      const action = todo.isCompleted ? 'uncomplete' : 'complete'
      useUIStore.getState().showBulkConfirmation(action, ids)
      return
    }

    useTodoStore.getState().toggleComplete(todoId)
  }, [])

  const remove = useCallback((todoId: number) => {
    const ids = getTargetIds(todoId)
    useUIStore.getState().showBulkConfirmation('delete', ids)
  }, [])

  const setDeadline = useCallback((todoId: number, date: Date | null) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetDeadline(ids, date)
    } else {
      void useTodoStore.getState().update(todoId, { dueDate: date ?? undefined })
    }
  }, [])

  const setFollowup = useCallback((todoId: number, date: Date | null) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetFollowup(ids, date)
    } else {
      void useTodoStore.getState().update(todoId, { nextFollowupAt: date ?? undefined })
    }
  }, [])

  /** Puts the task (or the selection it's part of) in focus, or takes it out. */
  const setFocus = useCallback((todoId: number, on: boolean) => {
    void useTodoStore.getState().bulkSetFocus(getTargetIds(todoId), on)
  }, [])

  /** Flags the task (or the selection it's part of) urgent, or clears the flag (a due date may still make it urgent). */
  const setUrgent = useCallback((todoId: number, on: boolean) => {
    void useTodoStore.getState().bulkSetUrgent(getTargetIds(todoId), on)
  }, [])

  /** Flags the task (or the selection it's part of) important, or clears the flag. */
  const setImportant = useCallback((todoId: number, on: boolean) => {
    void useTodoStore.getState().bulkSetImportant(getTargetIds(todoId), on)
  }, [])

  /** "Mark followed up" on the task (or the selection it's part of): `next` as given (`null` = none), else the automatic rule. */
  const markFollowedUp = useCallback((todoId: number, next?: Date | null) => {
    void useTodoStore.getState().markFollowedUp(getTargetIds(todoId), next === undefined ? undefined : { next })
  }, [])

  const setStatus = useCallback((todoId: number, statusId: number | undefined) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetStatus(ids, statusId)
    } else {
      void useTodoStore.getState().update(todoId, { statusId })
    }
  }, [])

  const quickAssignPerson = useCallback((todoId: number, personId: number) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      usePersonStore.getState().bulkAssignPerson(ids, personId)
    } else {
      usePersonStore.getState().assignPerson(todoId, personId)
    }
  }, [])

  const quickUnassignPerson = useCallback((todoId: number, personId: number) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      usePersonStore.getState().bulkUnassignPerson(ids, personId)
    } else {
      usePersonStore.getState().unassignPerson(todoId, personId)
    }
  }, [])

  const quickAssignTag = useCallback((todoId: number, tagId: number) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTagStore.getState().bulkAssignTag(ids, tagId)
    } else {
      useTagStore.getState().assignTag(todoId, tagId)
    }
  }, [])

  const quickUnassignTag = useCallback((todoId: number, tagId: number) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTagStore.getState().bulkUnassignTag(ids, tagId)
    } else {
      useTagStore.getState().unassignTag(todoId, tagId)
    }
  }, [])

  return {
    toggleComplete,
    remove,
    setFocus,
    setUrgent,
    setImportant,
    setStatus,
    setDeadline,
    setFollowup,
    markFollowedUp,
    quickAssignPerson,
    quickUnassignPerson,
    quickAssignTag,
    quickUnassignTag,
  }
}
