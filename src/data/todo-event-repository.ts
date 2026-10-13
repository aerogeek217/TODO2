import { db } from './database'
import type { TodoEvent, TodoEventType } from '../models'

/**
 * Append-only `todoEvents` repository. Writes flow exclusively through
 * `todo-repository` (which composes events into the same transaction as the
 * todo write). The rows are an append-only history that travels with exports
 * and task archives.
 */
export const todoEventRepository = {
  async add(event: Omit<TodoEvent, 'id'>): Promise<number> {
    return db.todoEvents.add(event as TodoEvent)
  },

  async bulkAdd(events: Omit<TodoEvent, 'id'>[]): Promise<void> {
    if (events.length === 0) return
    await db.todoEvents.bulkAdd(events as TodoEvent[])
  },

  async byTodo(todoId: number): Promise<TodoEvent[]> {
    return db.todoEvents.where('todoId').equals(todoId).toArray()
  },

  async getAll(): Promise<TodoEvent[]> {
    return db.todoEvents.toArray()
  },

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

  async deleteByTodo(todoId: number): Promise<void> {
    await db.todoEvents.where('todoId').equals(todoId).delete()
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
