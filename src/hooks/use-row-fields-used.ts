import { useMemo, useState } from 'react'
import type { PersistedTodoItem } from '../models'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { newestStatusUpdate, useStatusUpdateStore } from '../stores/status-update-store'
import { statusNotesPreview } from '../utils/notes-preview'
import { rowFieldsUsed } from '../utils/row-fields-used'
import { sameRowFields, type RowFieldsUsed } from '../utils/task-row-columns'

/**
 * The row fields a list's tasks use (flair P8), for its `TaskRowGrid`: the
 * same object while the set is unchanged, so the grid's columns don't
 * re-lay out on every store change.
 */
export function useRowFieldsUsed(todos: readonly PersistedTodoItem[]): RowFieldsUsed {
  const peopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const tagsMap = useTagStore((s) => s.assignedTagsMap)
  const updates = useStatusUpdateStore((s) => s.byTodo)
  const next = useMemo(() => rowFieldsUsed(todos, {
    hasPeople: (id) => (peopleMap.get(id)?.length ?? 0) > 0,
    hasTags: (id) => (tagsMap.get(id)?.length ?? 0) > 0,
    hasNotes: (todo) => statusNotesPreview(newestStatusUpdate(todo.id, updates), todo.notes) !== null,
  }), [todos, peopleMap, tagsMap, updates])
  const [kept, setKept] = useState(next)
  if (!sameRowFields(kept, next)) {
    setKept(next)
    return next
  }
  return kept
}
