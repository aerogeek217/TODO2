import { db } from './database'
import type { TodoEvent, TodoEventType } from '../models'

/**
 * Append-only `todoEvents` repository. Events are written in the same
 * transaction as the change they log: a task's fields by `todo-repository`,
 * its people and tags by the assignment writes (`join-helpers`, the person /
 * tag deletes and their undo, `entity-removal`) through
 * `logAssignmentEvents`. The rows are an append-only history that travels
 * with exports and task archives.
 */
export const todoEventRepository = {
  /**
   * Events at or after `from` (one indexed range read on `timestamp`),
   * optionally only of `types`.
   */
  async since(from: Date, types?: readonly TodoEventType[]): Promise<TodoEvent[]> {
    let collection = db.todoEvents.where('timestamp').aboveOrEqual(from.toISOString())
    if (types && types.length > 0) {
      const typeSet = new Set<TodoEventType>(types)
      collection = collection.filter((e) => typeSet.has(e.type))
    }
    return collection.toArray()
  },

  /**
   * Calls `listener` whenever an event row is added, changed or deleted
   * (Dexie table hooks; it runs inside the writing transaction, so it must
   * not touch the database itself). A table `clear()` does not notify.
   * Returns the unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    const table = db.todoEvents
    const notify = () => { listener() }
    table.hook('creating').subscribe(notify)
    table.hook('updating').subscribe(notify)
    table.hook('deleting').subscribe(notify)
    return () => {
      table.hook('creating').unsubscribe(notify)
      table.hook('updating').unsubscribe(notify)
      table.hook('deleting').unsubscribe(notify)
    }
  },
}

/** Encode a `Date | undefined` into the `fromValue` / `toValue` column shape. */
export function encodeDateValue(d: Date | undefined | null): string | null {
  if (d == null) return null
  if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString()
  if (typeof d === 'string') {
    const t = Date.parse(d)
    return isNaN(t) ? null : new Date(t).toISOString()
  }
  return null
}

/** The event types of a task's assignments. */
export type AssignmentEventType = 'person' | 'tag'

/**
 * One `person` / `tag` event per assignment in `rows` (`id` = the person's /
 * tag's id): an add logs the id as `toValue`, a remove as `fromValue`
 * (`models/todo-event`).
 */
export function assignmentEvents(
  type: AssignmentEventType,
  rows: readonly { todoId: number; id: number }[],
  change: 'add' | 'remove',
  timestamp: string,
): Omit<TodoEvent, 'id'>[] {
  return rows.map(({ todoId, id }) => ({
    todoId,
    type,
    fromValue: change === 'remove' ? id : null,
    toValue: change === 'add' ? id : null,
    timestamp,
  }))
}

/**
 * Logs `rows`' assignment changes now — only for the tasks that exist (an
 * assignment row can outlive its task until the audit). Runs inside the
 * caller's transaction, which must hold `todos` and `todoEvents`.
 */
export async function logAssignmentEvents(
  type: AssignmentEventType,
  rows: readonly { todoId: number; id: number }[],
  change: 'add' | 'remove',
  at: Date = new Date(),
): Promise<void> {
  if (rows.length === 0) return
  const todoIds = [...new Set(rows.map((r) => r.todoId))]
  const present = new Set((await db.todos.bulkGet(todoIds)).flatMap((t) => (t?.id != null ? [t.id] : [])))
  const events = assignmentEvents(type, rows.filter((r) => present.has(r.todoId)), change, at.toISOString())
  if (events.length > 0) await db.todoEvents.bulkAdd(events as TodoEvent[])
}
