import { useCallback } from 'react'
import { useUIStore } from '../stores/ui-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useOrgStore } from '../stores/org-store'
import type { Priority } from '../models'

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

    const { todos } = useTodoStore.getState()
    const todo = todos.find((t) => t.id === todoId)
    if (!todo) return

    // Completing a parent with incomplete children → prompt
    if (!todo.isCompleted) {
      const incompleteChildren = todos.filter(
        (t) => t.parentId === todoId && !t.isCompleted
      )
      if (incompleteChildren.length > 0) {
        const allIds = [todoId, ...incompleteChildren.map((t) => t.id)]
        useUIStore.getState().showBulkConfirmation('complete', allIds, {
          title: 'Complete with children',
          message: `Also complete ${incompleteChildren.length} child task${incompleteChildren.length > 1 ? 's' : ''}?`,
          confirmLabel: 'Complete all',
          cancelLabel: 'Just parent',
          skipIds: [todoId],
        })
        return
      }

      // Completing last incomplete child → prompt to complete parent
      if (todo.parentId != null) {
        const parent = todos.find((t) => t.id === todo.parentId)
        if (parent && !parent.isCompleted) {
          const incompleteSiblings = todos.filter(
            (t) => t.parentId === todo.parentId && t.id !== todoId && !t.isCompleted
          )
          if (incompleteSiblings.length === 0) {
            useUIStore.getState().showBulkConfirmation('complete', [todoId, parent.id], {
              title: 'Complete parent too?',
              message: 'All children will be complete. Also mark parent as complete?',
              confirmLabel: 'Complete both',
              cancelLabel: 'Just this task',
              skipIds: [todoId],
            })
            return
          }
        }
      }
    }

    useTodoStore.getState().toggleComplete(todoId)
  }, [])

  const toggleStar = useCallback((todoId: number) => {
    const ids = getTargetIds(todoId)
    const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
    if (!todo) return
    const targetStarred = !todo.isStarred
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetStarred(ids, targetStarred)
    } else {
      useTodoStore.getState().toggleStar(todoId)
    }
  }, [])

  const toggleAssigned = useCallback((todoId: number) => {
    const ids = getTargetIds(todoId)
    const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
    if (!todo) return
    const targetAssigned = !todo.isAssigned
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetAssigned(ids, targetAssigned)
    } else {
      useTodoStore.getState().toggleAssigned(todoId)
    }
  }, [])

  const remove = useCallback((todoId: number) => {
    const ids = getTargetIds(todoId)
    useUIStore.getState().showBulkConfirmation('delete', ids)
  }, [])

  const setPriority = useCallback((todoId: number, priority: Priority) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetPriority(ids, priority)
    } else {
      const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
      if (todo) useTodoStore.getState().update({ ...todo, priority })
    }
  }, [])

  const setDueDate = useCallback((todoId: number, date: Date | undefined) => {
    const ids = getTargetIds(todoId)
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetDueDate(ids, date)
    } else {
      const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
      if (todo) useTodoStore.getState().update({ ...todo, dueDate: date })
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

  return {
    toggleComplete,
    toggleStar,
    toggleAssigned,
    remove,
    setPriority,
    setDueDate,
    quickAssignPerson,
    quickUnassignPerson,
    quickAssignTag,
    quickUnassignTag,
    quickAssignOrg,
    quickUnassignOrg,
  }
}
