import { useCallback, useMemo } from 'react'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useOrgStore } from '../stores/org-store'
import { useProjectStore } from '../stores/project-store'
import { useCanvasStore } from '../stores/canvas-store'
import { useUIStore } from '../stores/ui-store'
import type { TodoItem } from '../models'
import { generateInitials } from '../utils/person'
import { parseTaskInput } from '../services/nlp-task-creator'

/**
 * Shared callbacks for TaskEditPopup wiring.
 * Encapsulates the ~70-line onCreate/onEdit pattern duplicated across views.
 */
export function useTaskEditCallbacks() {
  const { todos, update: updateTodo, add: addTodo } = useTodoStore()
  const { people, assignedPeopleMap, assignPerson, unassignPerson } = usePersonStore()
  const { tags, assignedTagsMap, assignTag, unassignTag } = useTagStore()
  const { orgs, assignedOrgsMap, assignOrg, unassignOrg } = useOrgStore()
  const { projects, add: addProject } = useProjectStore()
  const { selectedCanvasId } = useCanvasStore()
  const { selectedTodoId, editPopupMode, openEditPopup, closeEditPopup } = useUIStore()

  const selectedTodo = useMemo(
    () => todos.find((t) => t.id === selectedTodoId) ?? null,
    [todos, selectedTodoId]
  )

  const onCreate = useCallback(async (partial: Partial<TodoItem>, assignments?: { personIds: number[]; tagIds: number[]; orgIds: number[] }) => {
    const { title: parsedTitle, resolved } = parseTaskInput(partial.title!, people, tags, projects)
    let pid = resolved.projectId ?? partial.projectId
    if (!pid && selectedCanvasId) {
      pid = await addProject('New Project', selectedCanvasId)
    }
    const id = await addTodo(parsedTitle || partial.title!, selectedCanvasId ?? undefined, pid)
    const todo = useTodoStore.getState().todos.find((t) => t.id === id)
    if (todo) {
      const hasMeta = partial.priority !== undefined || partial.dueDate || partial.isStarred || partial.notes || resolved.priority !== undefined || resolved.dueDate || resolved.recurrence || partial.recurrenceRule
      if (hasMeta) {
        const dueDate = resolved.dueDate ?? partial.dueDate ?? todo.dueDate
        await updateTodo({
          ...todo,
          priority: resolved.priority ?? partial.priority ?? todo.priority,
          dueDate,
          isStarred: partial.isStarred ?? todo.isStarred,
          notes: partial.notes ?? todo.notes,
          recurrenceRule: partial.recurrenceRule ?? (dueDate && resolved.recurrence ? { type: resolved.recurrence } : undefined),
        })
      }
    }
    const allPersonIds = new Set([...resolved.personIds, ...(assignments?.personIds ?? [])])
    const allTagIds = new Set([...resolved.tagIds, ...(assignments?.tagIds ?? [])])
    for (const personId of allPersonIds) await assignPerson(id, personId)
    for (const tagId of allTagIds) await assignTag(id, tagId)
    if (assignments) {
      for (const orgId of assignments.orgIds) await assignOrg(id, orgId)
    }
    return id
  }, [selectedCanvasId, addTodo, updateTodo, assignPerson, assignTag, assignOrg, addProject, people, tags, projects])

  const editProps = useMemo(() => {
    if (!selectedTodo) return null
    return {
      todo: selectedTodo,
      assignedPeople: assignedPeopleMap.get(selectedTodo.id) ?? [],
      assignedTags: assignedTagsMap.get(selectedTodo.id) ?? [],
      assignedOrgs: assignedOrgsMap.get(selectedTodo.id) ?? [],
      onUpdate: updateTodo,
      onToggleComplete: () => useTodoStore.getState().toggleComplete(selectedTodo.id),
      onToggleStar: () => useTodoStore.getState().toggleStar(selectedTodo.id),
      onDelete: () => useUIStore.getState().showBulkConfirmation('delete', [selectedTodo.id]),
      onDuplicate: async () => {
        const newId = await useTodoStore.getState().duplicate(selectedTodo.id)
        if (newId) { closeEditPopup(); openEditPopup(newId) }
      },
      onAssignPerson: (personId: number) => { if (selectedTodoId) assignPerson(selectedTodoId, personId) },
      onUnassignPerson: (personId: number) => { if (selectedTodoId) unassignPerson(selectedTodoId, personId) },
      onAssignTag: (tagId: number) => { if (selectedTodoId) assignTag(selectedTodoId, tagId) },
      onUnassignTag: (tagId: number) => { if (selectedTodoId) unassignTag(selectedTodoId, tagId) },
      onAssignOrg: (orgId: number) => { if (selectedTodoId) assignOrg(selectedTodoId, orgId) },
      onUnassignOrg: (orgId: number) => { if (selectedTodoId) unassignOrg(selectedTodoId, orgId) },
    }
  }, [selectedTodo, selectedTodoId, assignedPeopleMap, assignedTagsMap, assignedOrgsMap, updateTodo, closeEditPopup, openEditPopup, assignPerson, unassignPerson, assignTag, unassignTag, assignOrg, unassignOrg])

  const entityCreators = useMemo(() => ({
    onCreatePerson: (name: string) => {
      const initials = generateInitials(name)
      return usePersonStore.getState().add(name, initials)
    },
    onCreateTag: (name: string) => useTagStore.getState().add(name),
    onCreateOrg: (name: string) => useOrgStore.getState().add(name),
  }), [])

  return {
    selectedTodo,
    editPopupMode,
    closeEditPopup,
    allPeople: people,
    allTags: tags,
    allOrgs: orgs,
    onCreate,
    editProps,
    entityCreators,
  }
}
