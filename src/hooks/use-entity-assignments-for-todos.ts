import { useEffect } from 'react'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'

/**
 * Loads the people / tag assignment joins of every loaded task, so the
 * workspace's chips and person / tag groups render on a cold load
 * (`assignedPeopleMap` / `assignedTagsMap`).
 *
 * It subscribes only to the task count and `todosVersion` — bumped on add /
 * remove / bulk-remove / restore / purge, i.e. when the *set of ids*
 * changes — never to the `todos` array itself, so an edit to a task re-runs
 * neither the load nor the component that calls this.
 */
export function useEntityAssignmentsForLoadedTodos(): void {
  const count = useTodoStore((s) => s.todos.length)
  const todosVersion = useTodoStore((s) => s.todosVersion)
  const loadPeopleAssignments = usePersonStore((s) => s.loadAssignments)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)

  useEffect(() => {
    if (count === 0) return
    const ids = useTodoStore.getState().todos.map((t) => t.id)
    void loadPeopleAssignments(ids)
    void loadTagAssignments(ids)
  }, [count, todosVersion, loadPeopleAssignments, loadTagAssignments])
}
