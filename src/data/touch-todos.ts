import { db } from './database'

/**
 * A write to rows that belong to tasks (status updates, subtasks) counts as
 * activity on those tasks: given `at`, the repository stamps their
 * `modifiedAt` in its own transaction, so a task doesn't go stale while its
 * entries come in. Both helpers run inside the caller's transaction.
 */

/** The ids among `rows`' tasks that exist. */
export async function presentTodoIds(rows: readonly { todoId: number }[]): Promise<Set<number>> {
  const todoIds = [...new Set(rows.map((r) => r.todoId))]
  if (todoIds.length === 0) return new Set()
  return new Set((await db.todos.bulkGet(todoIds)).flatMap((t) => (t?.id != null ? [t.id] : [])))
}

/** Stamps `modifiedAt` = `at` on the tasks `todoIds`; nothing without `at`. */
export async function touchTodoIds(todoIds: Iterable<number>, at: Date | undefined): Promise<void> {
  if (!at) return
  const ids = [...new Set(todoIds)]
  if (ids.length === 0) return
  await db.todos.where('id').anyOf(ids).modify({ modifiedAt: at })
}

/** `touchTodoIds` for `rows`' tasks. */
export async function touchTodos(rows: readonly { todoId: number }[], at: Date | undefined): Promise<void> {
  if (!at || rows.length === 0) return
  await touchTodoIds(rows.map((r) => r.todoId), at)
}
