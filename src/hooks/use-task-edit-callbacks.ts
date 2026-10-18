import { useCallback, useMemo } from 'react'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useUIStore } from '../stores/ui-store'
import type { TodoItem, TodoChanges } from '../models'
import { createEditorTask } from '../services/create-task'

/** Return the IDs of other multi-selected tasks (excluding the primary edit target). */
function getOtherSelectedIds(primaryId: number): number[] {
  const { selectedTodoIds } = useUIStore.getState()
  if (selectedTodoIds.size <= 1) return []
  return [...selectedTodoIds].filter(id => id !== primaryId)
}

/**
 * Shared callbacks for TaskEditPopup wiring: create (`createEditorTask`),
 * and the edit-mode callbacks that also apply to the other selected tasks.
 */
export function useTaskEditCallbacks() {
  const { todos, update: updateTodo } = useTodoStore()
  const { people, assignedPeopleMap, assignPerson, unassignPerson } = usePersonStore()
  const { tags, assignedTagsMap, assignTag, unassignTag } = useTagStore()
  const { selectedTodoId, editPopupMode, openEditPopup, closeEditPopup } = useUIStore()

  const selectedTodo = useMemo(
    () => todos.find((t) => t.id === selectedTodoId) ?? null,
    [todos, selectedTodoId]
  )

  const onCreate = useCallback(async (partial: Partial<TodoItem>, assignments?: { personIds: number[]; tagIds?: number[] }) => {
    const id = await createEditorTask(partial, {
      personIds: assignments?.personIds ?? [],
      tagIds: assignments?.tagIds ?? [],
    })
    if (id != null) useUIStore.getState().showRecentlyCreated(id)
    return id
  }, [])

  /**
   * Saves the editor's changes to the task, and applies the bulk-applicable
   * ones to the other selected tasks: status, due date and both follow-up
   * dates (like "Followed up").
   */
  const bulkAwareUpdate = useCallback((id: number, changes: TodoChanges) => {
    // The task's values before this edit (the optimistic update replaces them).
    const current = useTodoStore.getState().todos.find(t => t.id === id)

    void updateTodo(id, changes)

    const otherIds = getOtherSelectedIds(id)
    if (otherIds.length === 0 || !current) return

    const store = useTodoStore.getState()
    if ('statusId' in changes && changes.statusId !== current.statusId)
      store.bulkSetStatus(otherIds, changes.statusId)
    if ('dueDate' in changes && changes.dueDate?.getTime() !== current.dueDate?.getTime())
      store.bulkSetDeadline(otherIds, changes.dueDate ?? null)
    if ('nextFollowupAt' in changes && changes.nextFollowupAt?.getTime() !== current.nextFollowupAt?.getTime())
      store.bulkSetFollowup(otherIds, changes.nextFollowupAt ?? null)
    if ('lastFollowupAt' in changes && changes.lastFollowupAt?.getTime() !== current.lastFollowupAt?.getTime())
      store.bulkSetLastFollowup(otherIds, changes.lastFollowupAt ?? null)
  }, [updateTodo])

  const editProps = useMemo(() => {
    if (!selectedTodo) return null

    const bulkAssign = (
      singleFn: (todoId: number, entityId: number) => void,
      bulkFn: (ids: number[], entityId: number) => void,
    ) => (entityId: number) => {
      if (!selectedTodoId) return
      singleFn(selectedTodoId, entityId)
      const otherIds = getOtherSelectedIds(selectedTodoId)
      if (otherIds.length > 0) bulkFn(otherIds, entityId)
    }

    return {
      todo: selectedTodo,
      assignedPeople: assignedPeopleMap.get(selectedTodo.id) ?? [],
      assignedTags: assignedTagsMap.get(selectedTodo.id) ?? [],
      onUpdate: (changes: TodoChanges) => bulkAwareUpdate(selectedTodo.id, changes),
      onToggleComplete: () => useTodoStore.getState().toggleComplete(selectedTodo.id),
      onFollowedUp: () => {
        useTodoStore.getState().markFollowedUp([selectedTodo.id, ...getOtherSelectedIds(selectedTodo.id)])
      },
      onDelete: () => {
        const ids = getOtherSelectedIds(selectedTodo.id)
        useUIStore.getState().showBulkConfirmation('delete', [selectedTodo.id, ...ids])
      },
      onDuplicate: async () => {
        const newId = await useTodoStore.getState().duplicate(selectedTodo.id)
        if (newId) { closeEditPopup(); openEditPopup(newId) }
      },
      onAssignPerson: bulkAssign(assignPerson, usePersonStore.getState().bulkAssignPerson),
      onUnassignPerson: bulkAssign(unassignPerson, usePersonStore.getState().bulkUnassignPerson),
      onAssignTag: bulkAssign(assignTag, useTagStore.getState().bulkAssignTag),
      onUnassignTag: bulkAssign(unassignTag, useTagStore.getState().bulkUnassignTag),
    }
  }, [selectedTodo, selectedTodoId, assignedPeopleMap, assignedTagsMap, bulkAwareUpdate, closeEditPopup, openEditPopup, assignPerson, unassignPerson, assignTag, unassignTag])

  const entityCreators = useMemo(() => ({
    onCreatePerson: (name: string) => usePersonStore.getState().getOrCreate(name),
    onCreateTag: (name: string) => useTagStore.getState().add(name),
  }), [])

  return {
    selectedTodo,
    editPopupMode,
    closeEditPopup,
    allPeople: people,
    allTags: tags,
    onCreate,
    editProps,
    entityCreators,
  }
}
