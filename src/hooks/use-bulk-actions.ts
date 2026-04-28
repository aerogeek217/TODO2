import { useCallback } from 'react'
import { useUIStore } from '../stores/ui-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useOrgStore } from '../stores/org-store'
import { useTagStore } from '../stores/tag-store'
import type { ScheduledValue } from '../models/scheduled-value'

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

  const setScheduled = useCallback((todoId: number, value: ScheduledValue | null) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetScheduled(ids, value)
    } else {
      const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
      if (todo) useTodoStore.getState().update({ ...todo, scheduledDate: value ?? undefined })
    }
  }, [])

  const setDeadline = useCallback((todoId: number, date: Date | null) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetDeadline(ids, date)
    } else {
      const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
      if (todo) useTodoStore.getState().update({ ...todo, dueDate: date ?? undefined })
    }
  }, [])

  const setStatus = useCallback((todoId: number, statusId: number | undefined) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetStatus(ids, statusId)
    } else {
      const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
      if (todo) useTodoStore.getState().update({ ...todo, statusId, modifiedAt: new Date() })
    }
  }, [])

  const setProject = useCallback((todoId: number, projectId: number | undefined) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetProject(ids, projectId)
    } else {
      const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
      if (todo) useTodoStore.getState().update({ ...todo, projectId })
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

  const quickAssignOrg = useCallback((todoId: number, orgId: number) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useOrgStore.getState().bulkAssignOrg(ids, orgId)
    } else {
      useOrgStore.getState().assignOrg(todoId, orgId)
    }
  }, [])

  const quickUnassignOrg = useCallback((todoId: number, orgId: number) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useOrgStore.getState().bulkUnassignOrg(ids, orgId)
    } else {
      useOrgStore.getState().unassignOrg(todoId, orgId)
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
    setStatus,
    setScheduled,
    setDeadline,
    setProject,
    quickAssignPerson,
    quickUnassignPerson,
    quickAssignOrg,
    quickUnassignOrg,
    quickAssignTag,
    quickUnassignTag,
  }
}
