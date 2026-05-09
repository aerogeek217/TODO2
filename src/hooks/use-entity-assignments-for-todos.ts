import { useEffect } from 'react'
import type { PersistedTodoItem } from '../models'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useOrgStore } from '../stores/org-store'
import { useTagStore } from '../stores/tag-store'

/**
 * Load people / org / tag assignment joins for a visible todo set. Used by
 * surfaces that read `assignedPeopleMap` / `assignedOrgsMap` /
 * `assignedTagsMap` (ListView, CalendarView, CanvasPage) so each isn't
 * repeating the same triple-load `useEffect`.
 *
 * Identity-stable dep: re-running on raw `todos` identity would re-fire on
 * every attribute edit (a single field flip recreates the array reference).
 * `todosVersion` is bumped only on add / remove / bulk-remove / restore /
 * purge — i.e. when the *set of ids* actually changes — so gating on
 * `${length}:${version}` pins the join load to real composition changes.
 */
export function useEntityAssignmentsForTodos(todos: PersistedTodoItem[]): void {
  const todosVersion = useTodoStore((s) => s.todosVersion)
  const loadPeopleAssignments = usePersonStore((s) => s.loadAssignments)
  const loadOrgAssignments = useOrgStore((s) => s.loadAssignments)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)

  const todoIdsKey = `${todos.length}:${todosVersion}`
  useEffect(() => {
    if (todos.length === 0) return
    const ids = todos.map((t) => t.id)
    loadPeopleAssignments(ids)
    loadOrgAssignments(ids)
    loadTagAssignments(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoIdsKey, loadPeopleAssignments, loadOrgAssignments, loadTagAssignments])
}
