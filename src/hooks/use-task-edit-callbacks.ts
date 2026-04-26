import { useCallback, useMemo } from 'react'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useOrgStore } from '../stores/org-store'
import { useProjectStore } from '../stores/project-store'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useCanvasStore } from '../stores/canvas-store'
import { useUIStore } from '../stores/ui-store'
import type { TodoItem, PersistedTodoItem } from '../models'
import { generateInitials } from '../utils/person'
import { parseTaskInput } from '../services/nlp-task-creator'
import { resolveTags } from '../services/nlp-resolver'
import { makeRecurrenceRule } from '../services/recurrence'
import { scheduledValuesEqual } from '../utils/effective-date'

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
  const { orgs, assignedOrgsMap, assignOrg, unassignOrg } = useOrgStore()
  const { tags, assignedTagsMap, assignTag, unassignTag } = useTagStore()
  const { statuses } = useStatusStore()
  const { projects, add: addProject } = useProjectStore()
  const { selectedCanvasId } = useCanvasStore()
  const { selectedTodoId, editPopupMode, openEditPopup, closeEditPopup } = useUIStore()

  const selectedTodo = useMemo(
    () => todos.find((t) => t.id === selectedTodoId) ?? null,
    [todos, selectedTodoId]
  )

  const onCreate = useCallback(async (partial: Partial<TodoItem>, assignments?: { personIds: number[]; orgIds: number[]; tagIds?: number[] }) => {
    const { title: parsedTitle, resolved } = parseTaskInput(partial.title!, people, projects, orgs, statuses)
    let pid = resolved.projectId ?? partial.projectId
    if (!pid && selectedCanvasId) {
      pid = await addProject('New Project', selectedCanvasId)
    }
    const id = await addTodo(parsedTitle || partial.title!, selectedCanvasId ?? undefined, pid)
    const todo = useTodoStore.getState().todos.find((t) => t.id === id)
    if (todo) {
      const hasMeta =
        partial.scheduledDate !== undefined || partial.dueDate !== undefined ||
        partial.notes || partial.statusId !== undefined ||
        resolved.scheduledDate !== undefined || resolved.recurrence ||
        resolved.statusId !== undefined ||
        partial.recurrenceRule
      if (hasMeta) {
        const nextDeadline = partial.dueDate ?? todo.dueDate
        await updateTodo({
          ...todo,
          scheduledDate: resolved.scheduledDate ?? partial.scheduledDate ?? todo.scheduledDate,
          dueDate: nextDeadline,
          statusId: resolved.statusId ?? partial.statusId ?? todo.statusId,
          notes: partial.notes ?? todo.notes,
          recurrenceRule: partial.recurrenceRule
            ?? (nextDeadline && resolved.recurrence ? makeRecurrenceRule(resolved.recurrence, nextDeadline) : undefined),
        })
      }
    }
    const allPersonIds = new Set([...resolved.personIds, ...(assignments?.personIds ?? [])])
    const allOrgIds = new Set([...resolved.orgIds, ...(assignments?.orgIds ?? [])])
    for (const personId of allPersonIds) await assignPerson(id, personId)
    for (const orgId of allOrgIds) await assignOrg(id, orgId)
    // Registry-side writes: resolve-or-create NLP tags + apply any pending ids
    // picked in the popup's chip selector.
    const nlpTagIds = resolved.tags.length > 0
      ? await resolveTags(resolved.tags, { tagStore: useTagStore.getState() })
      : []
    const allTagIds = new Set<number>([...nlpTagIds, ...(assignments?.tagIds ?? [])])
    for (const tagId of allTagIds) await useTagStore.getState().assignTag(id, tagId)
    return id
  }, [selectedCanvasId, addTodo, updateTodo, assignPerson, assignOrg, addProject, people, projects, orgs, statuses])

  /** Wrap onUpdate to propagate bulk-applicable field changes to other selected tasks. */
  const bulkAwareUpdate = useCallback((updated: PersistedTodoItem) => {
    // Snapshot store state BEFORE the optimistic update modifies it
    const current = useTodoStore.getState().todos.find(t => t.id === updated.id)

    updateTodo(updated)

    const otherIds = getOtherSelectedIds(updated.id)
    if (otherIds.length === 0 || !current) return

    const store = useTodoStore.getState()
    if (updated.statusId !== current.statusId)
      store.bulkSetStatus(otherIds, updated.statusId)
    if (!scheduledValuesEqual(updated.scheduledDate, current.scheduledDate))
      store.bulkSetScheduled(otherIds, updated.scheduledDate ?? null)
    if (updated.dueDate?.getTime() !== current.dueDate?.getTime())
      store.bulkSetDeadline(otherIds, updated.dueDate ?? null)
    if (updated.projectId !== current.projectId)
      store.bulkSetProject(otherIds, updated.projectId)
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
      assignedOrgs: assignedOrgsMap.get(selectedTodo.id) ?? [],
      assignedTags: assignedTagsMap.get(selectedTodo.id) ?? [],
      onUpdate: bulkAwareUpdate,
      onToggleComplete: () => useTodoStore.getState().toggleComplete(selectedTodo.id),
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
      onAssignOrg: bulkAssign(assignOrg, useOrgStore.getState().bulkAssignOrg),
      onUnassignOrg: bulkAssign(unassignOrg, useOrgStore.getState().bulkUnassignOrg),
      onAssignTag: bulkAssign(assignTag, useTagStore.getState().bulkAssignTag),
      onUnassignTag: bulkAssign(unassignTag, useTagStore.getState().bulkUnassignTag),
    }
  }, [selectedTodo, selectedTodoId, assignedPeopleMap, assignedOrgsMap, assignedTagsMap, bulkAwareUpdate, closeEditPopup, openEditPopup, assignPerson, unassignPerson, assignOrg, unassignOrg, assignTag, unassignTag])

  const entityCreators = useMemo(() => ({
    onCreatePerson: (name: string) => {
      const initials = generateInitials(name)
      return usePersonStore.getState().add(name, initials)
    },
    onCreateOrg: (name: string) => useOrgStore.getState().add(name),
    onCreateTag: (name: string) => useTagStore.getState().add(name),
  }), [])

  return {
    selectedTodo,
    editPopupMode,
    closeEditPopup,
    allPeople: people,
    allOrgs: orgs,
    allTags: tags,
    onCreate,
    editProps,
    entityCreators,
  }
}
