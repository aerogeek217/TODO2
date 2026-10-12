import { useCallback, useMemo } from 'react'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useUIStore } from '../stores/ui-store'
import type { TodoItem, PersistedTodoItem } from '../models'
import { parseTaskInput } from '../services/nlp-task-creator'
import { resolveTags, resolveUnmatchedPeople } from '../services/nlp-resolver'
import { makeRecurrenceRule } from '../services/recurrence'

/** Return the IDs of other multi-selected tasks (excluding the primary edit target). */
function getOtherSelectedIds(primaryId: number): number[] {
  const { selectedTodoIds } = useUIStore.getState()
  if (selectedTodoIds.size <= 1) return []
  return [...selectedTodoIds].filter(id => id !== primaryId)
}

/**
 * Shared callbacks for TaskEditPopup wiring.
 * Encapsulates the ~70-line onCreate/onEdit pattern duplicated across views.
 */
export function useTaskEditCallbacks() {
  const { todos, update: updateTodo, add: addTodo } = useTodoStore()
  const { people, assignedPeopleMap, assignPerson, unassignPerson } = usePersonStore()
  const { tags, assignedTagsMap, assignTag, unassignTag } = useTagStore()
  const { statuses } = useStatusStore()
  const { selectedTodoId, editPopupMode, openEditPopup, closeEditPopup } = useUIStore()

  const selectedTodo = useMemo(
    () => todos.find((t) => t.id === selectedTodoId) ?? null,
    [todos, selectedTodoId]
  )

  const onCreate = useCallback(async (partial: Partial<TodoItem>, assignments?: { personIds: number[]; tagIds?: number[] }) => {
    const { title: parsedTitle, resolved } = parseTaskInput(partial.title!, people, statuses)
    const id = await addTodo(parsedTitle || partial.title!)
    const todo = useTodoStore.getState().todos.find((t) => t.id === id)
    if (todo) {
      const followupTouched = 'nextFollowupAt' in partial || partial.lastFollowupAt !== undefined
        || resolved.nextFollowupAt !== undefined || resolved.followupNone === true
      const urgent = partial.urgent === true || resolved.urgent === true
      const important = partial.important === true || resolved.important === true
      const focus = partial.focus === true || resolved.focus === true
      const hasMeta =
        followupTouched ||
        partial.dueDate !== undefined ||
        partial.notes || partial.statusId !== undefined ||
        resolved.dueDate !== undefined || resolved.recurrence ||
        resolved.statusId !== undefined ||
        partial.recurrenceRule ||
        urgent || important || focus
      if (hasMeta) {
        const nextDeadline = partial.dueDate ?? resolved.dueDate ?? todo.dueDate
        // The editor's Next field (passed when changed or cleared from the
        // default) wins; otherwise a `/followup` in the title, else the default.
        const nextFollowupAt = 'nextFollowupAt' in partial
          ? partial.nextFollowupAt
          : resolved.followupNone ? undefined : (resolved.nextFollowupAt ?? todo.nextFollowupAt)
        await updateTodo({
          ...todo,
          dueDate: nextDeadline,
          statusId: resolved.statusId ?? partial.statusId ?? todo.statusId,
          notes: partial.notes ?? todo.notes,
          nextFollowupAt,
          lastFollowupAt: partial.lastFollowupAt ?? todo.lastFollowupAt,
          ...(focus ? { focus: true } : {}),
          ...(urgent ? { urgent: true } : {}),
          ...(important ? { important: true } : {}),
          recurrenceRule: partial.recurrenceRule
            ?? (nextDeadline && resolved.recurrence ? makeRecurrenceRule(resolved.recurrence, nextDeadline) : undefined),
        })
      }
    }
    // `@name` tokens that matched nobody create the person (lookup-or-create).
    const newPersonIds = resolved.unmatchedPersons.length > 0
      ? await resolveUnmatchedPeople(resolved.unmatchedPersons, { personStore: usePersonStore.getState() })
      : []
    const allPersonIds = new Set([...resolved.personIds, ...newPersonIds, ...(assignments?.personIds ?? [])])
    for (const personId of allPersonIds) await assignPerson(id, personId)
    // Registry-side writes: resolve-or-create NLP tags + apply any pending ids
    // picked in the popup's chip selector.
    const nlpTagIds = resolved.tags.length > 0
      ? await resolveTags(resolved.tags, { tagStore: useTagStore.getState() })
      : []
    const allTagIds = new Set<number>([...nlpTagIds, ...(assignments?.tagIds ?? [])])
    for (const tagId of allTagIds) await useTagStore.getState().assignTag(id, tagId)
    useUIStore.getState().showRecentlyCreated(id)
    return id
  }, [addTodo, updateTodo, assignPerson, people, statuses])

  /**
   * Wrap onUpdate to propagate bulk-applicable field changes to other selected
   * tasks: status, due date and both follow-up dates (like "Followed up").
   */
  const bulkAwareUpdate = useCallback((updated: PersistedTodoItem) => {
    // Snapshot store state BEFORE the optimistic update modifies it
    const current = useTodoStore.getState().todos.find(t => t.id === updated.id)

    updateTodo(updated)

    const otherIds = getOtherSelectedIds(updated.id)
    if (otherIds.length === 0 || !current) return

    const store = useTodoStore.getState()
    if (updated.statusId !== current.statusId)
      store.bulkSetStatus(otherIds, updated.statusId)
    if (updated.dueDate?.getTime() !== current.dueDate?.getTime())
      store.bulkSetDeadline(otherIds, updated.dueDate ?? null)
    if (updated.nextFollowupAt?.getTime() !== current.nextFollowupAt?.getTime())
      store.bulkSetFollowup(otherIds, updated.nextFollowupAt ?? null)
    if (updated.lastFollowupAt?.getTime() !== current.lastFollowupAt?.getTime())
      store.bulkSetLastFollowup(otherIds, updated.lastFollowupAt ?? null)
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
      onUpdate: bulkAwareUpdate,
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
