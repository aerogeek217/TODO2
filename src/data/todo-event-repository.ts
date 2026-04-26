import { db } from './database'
import type { TodoEvent, TodoEventType, ScheduledValue } from '../models'

/**
 * Append-only `todoEvents` repository. Writes flow exclusively through
 * `todo-repository` (which composes events into the same transaction as the
 * todo write); reads power the scoreboard + snooze-graveyard widgets.
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
   * Events whose `timestamp` falls within `[from, to)` (start inclusive,
   * end exclusive). Optional `types` filter keeps the predicate cheap when
   * a caller only needs e.g. `'scheduled'` events.
   *
   * `timestamp` is a string column but ISO-8601 sorts lexically — Dexie's
   * `between` treats string ranges as a string compare, which matches our
   * desired semantics. Caller-supplied Dates are converted to ISO.
   */
  async inRange(
    from: Date,
    to: Date,
    types?: readonly TodoEventType[],
  ): Promise<TodoEvent[]> {
    const fromIso = from.toISOString()
    const toIso = to.toISOString()
    let collection = db.todoEvents.where('timestamp').between(fromIso, toIso, true, false)
    if (types && types.length > 0) {
      const typeSet = new Set<TodoEventType>(types)
      collection = collection.filter((e) => typeSet.has(e.type))
    }
    return collection.toArray()
  },

  async deleteByTodo(todoId: number): Promise<void> {
    await db.todoEvents.where('todoId').equals(todoId).delete()
  },
}

/**
 * Encode a `ScheduledValue | undefined` into the `fromValue` / `toValue`
 * column shape. `null` for unset; ISO string for fixed dates; `'fuzzy:<token>'`
 * for fuzzy. The fuzzy prefix disambiguates from a date string so the inverse
 * mapping (if ever needed) is unambiguous.
 */
export function encodeScheduledValue(v: ScheduledValue | undefined | null): string | null {
  if (v == null) return null
  if (v.kind === 'date') {
    if (v.value instanceof Date) return v.value.toISOString()
    if (typeof v.value === 'string') {
      const t = Date.parse(v.value as unknown as string)
      return isNaN(t) ? null : new Date(t).toISOString()
    }
    return null
  }
  if (v.kind === 'fuzzy') return `fuzzy:${v.token}`
  return null
}

/** Encode a `Date | undefined` into the `fromValue` / `toValue` column shape. */
export function encodeDateValue(d: Date | undefined | null): string | null {
  if (d == null) return null
  if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString()
  if (typeof d === 'string') {
    const t = Date.parse(d as unknown as string)
    return isNaN(t) ? null : new Date(t).toISOString()
  }
  return null
}

/** Two encoded scalar values are equal — used to skip no-op edits. */
export function encodedEqual(a: string | number | null, b: string | number | null): boolean {
  return a === b
}
