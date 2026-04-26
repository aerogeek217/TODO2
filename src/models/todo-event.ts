/**
 * Append-only history log entry. One row per tracked-field mutation on a
 * todo (`scheduledDate` / `dueDate` / `isCompleted` / `statusId`) plus a
 * `created` event at insert time. Events are emitted only when the value
 * actually changes (idempotent — `from !== to`).
 *
 * Backing store: `db.todoEvents` (Dexie v42, `++id, todoId, type, timestamp`).
 *
 * `fromValue` / `toValue` encoding:
 *   - `scheduled` / `deadline` — ISO date string for fixed dates; the fuzzy-
 *     token string for `ScheduledValue.kind === 'fuzzy'` (prefixed with
 *     `fuzzy:` to disambiguate). `null` when the field was unset.
 *   - `status` — numeric `statusId`, or `null` when unset.
 *   - `created` / `completed` / `reopened` — both null (the event type
 *     carries the meaning).
 */
export type TodoEventType =
  | 'created'
  | 'scheduled'
  | 'deadline'
  | 'status'
  | 'completed'
  | 'reopened'

export interface TodoEvent {
  id?: number
  todoId: number
  type: TodoEventType
  fromValue: string | number | null
  toValue: string | number | null
  /** ISO timestamp. */
  timestamp: string
}

/** TodoEvent after persistence — id is always defined. */
export type PersistedTodoEvent = TodoEvent & { id: number }
