import { db } from './database'
import { stampAfter, type Stamp, type StampChange } from '../utils/task-stamps'

/**
 * A write to rows that belong to tasks (status updates, subtasks, people and
 * tags) counts as activity on those tasks: given a `TaskTouch`, the
 * repository stamps their `modifiedAt` in its own transaction, so a task
 * doesn't go stale while its entries come in — a new write with its time, an
 * undo / redo putting back a step's stamps (`utils/task-stamps`). The
 * helpers run inside the caller's transaction.
 */

/**
 * The stamp a write puts on its tasks (`stamp`), and — once it has run —
 * what it put: each task's `modifiedAt` before and after (`stamped`; a task
 * whose stamp it left as it was is not listed). The store reads `stamped` to
 * keep its copies in step, and a step keeps it for its undo / redo.
 */
export interface TaskTouch {
  readonly stamp: Stamp
  readonly stamped: Map<number, StampChange>
}

/** A `TaskTouch` for a write with `stamp`, its record still empty. */
export function taskTouch(stamp: Stamp): TaskTouch {
  return { stamp, stamped: new Map() }
}

/** The ids among `rows`' tasks that exist. */
export async function presentTodoIds(rows: readonly { todoId: number }[]): Promise<Set<number>> {
  const todoIds = [...new Set(rows.map((r) => r.todoId))]
  if (todoIds.length === 0) return new Set()
  return new Set((await db.todos.bulkGet(todoIds)).flatMap((t) => (t?.id != null ? [t.id] : [])))
}

/** Stamps the tasks `todoIds` (those that exist) by `touch`, recording what it wrote; nothing without `touch`. */
export async function touchTodoIds(todoIds: Iterable<number>, touch: TaskTouch | undefined): Promise<void> {
  if (!touch) return
  const ids = [...new Set(todoIds)]
  if (ids.length === 0) return
  const rows = await db.todos.bulkGet(ids)
  for (const [i, id] of ids.entries()) {
    const row = rows[i]
    if (!row) continue
    const before = row.modifiedAt
    const after = stampAfter(touch.stamp, id, before)
    // An undo / redo whose guard didn't pass leaves the task's own stamp.
    if (!(touch.stamp instanceof Date) && after === before) continue
    await db.todos.update(id, { modifiedAt: after })
    touch.stamped.set(id, { before, after })
  }
}

/** `touchTodoIds` for `rows`' tasks. */
export async function touchTodos(rows: readonly { todoId: number }[], touch: TaskTouch | undefined): Promise<void> {
  if (!touch || rows.length === 0) return
  await touchTodoIds(rows.map((r) => r.todoId), touch)
}
