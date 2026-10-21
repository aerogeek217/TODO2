import { useEffect } from 'react'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'

/**
 * Runs `load` with the ids of every loaded task, again whenever the set of
 * ids changes. It subscribes only to the task count and `todosVersion` —
 * bumped on add / remove / bulk-remove / restore / purge, i.e. when the *set
 * of ids* changes — never to the `todos` array itself, so an edit to a task
 * re-runs neither the load nor the component that calls this.
 */
function useLoadForLoadedTodoIds(load: (ids: number[]) => Promise<void>): void {
  const count = useTodoStore((s) => s.todos.length)
  const todosVersion = useTodoStore((s) => s.todosVersion)
  useEffect(() => {
    if (count === 0) return
    void load(useTodoStore.getState().todos.map((t) => t.id))
  }, [count, todosVersion, load])
}

/** The people assignment joins of every loaded task (`assignedPeopleMap`); see `useLoadForLoadedTodoIds`. */
export function usePersonAssignmentsForLoadedTodos(): void {
  useLoadForLoadedTodoIds(usePersonStore((s) => s.loadAssignments))
}

/** The tag assignment joins of every loaded task (`assignedTagsMap`); see `useLoadForLoadedTodoIds`. */
export function useTagAssignmentsForLoadedTodos(): void {
  useLoadForLoadedTodoIds(useTagStore((s) => s.loadAssignments))
}

/**
 * Loads the people / tag assignment joins of every loaded task, so the
 * workspace's chips and person / tag groups render on a cold load
 * (`assignedPeopleMap` / `assignedTagsMap`).
 */
export function useEntityAssignmentsForLoadedTodos(): void {
  usePersonAssignmentsForLoadedTodos()
  useTagAssignmentsForLoadedTodos()
}
