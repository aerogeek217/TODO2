/**
 * Append-only history log entry: one row per change to a tracked field of a
 * todo, plus a `created` event at insert time. Events are emitted only when
 * the value actually changes (idempotent — `from !== to`), in the same
 * transaction as the write.
 *
 * Backing store: `db.todoEvents` (Dexie v42, `++id, todoId, type, timestamp`).
 *
 * Tracked since the log began: the due date (`deadline`), the status
 * (`status`) and completion (`completed` / `reopened`). Tracked since the
 * history log H3 (D26; the `historyLogSince` settings row says when this
 * database began): the next and last follow-up dates (`followup` /
 * `followedUp`), the priority markers (`marker`) and the task's people and
 * tags (`person` / `tag`). Only a v78 file may carry the H3 types.
 *
 * `fromValue` / `toValue` encoding:
 *   - `deadline` / `followup` / `followedUp` — the due date / next follow-up /
 *     last follow-up as an ISO date-time string, or `null` when unset.
 *   - `scheduled` — history only (the scheduled date was removed; no new
 *     events are written): ISO date string, `fuzzy:<token>`, or `null`.
 *   - `status` — numeric `statusId`, or `null` when unset.
 *   - `marker` — the flags set, as their names joined by commas in the fixed
 *     order `urgent,important,focus` (`urgent`, `important,focus`, …), or
 *     `null` when none is set ({@link encodeMarkerFlags}). Only the stored
 *     flags: urgency by due date is never logged (it follows the due date).
 *   - `person` / `tag` — one assignment: an add has `toValue` = the person's /
 *     tag's id and `fromValue` `null`; a remove has `fromValue` = the id and
 *     `toValue` `null`. A create logs each of its people and tags as an add
 *     at the create timestamp.
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
  | 'followup'
  | 'followedUp'
  | 'marker'
  | 'person'
  | 'tag'

/** Every event type, in the order the log gained them. */
export const TODO_EVENT_TYPES: readonly TodoEventType[] = [
  'created', 'scheduled', 'deadline', 'status', 'completed', 'reopened',
  'followup', 'followedUp', 'marker', 'person', 'tag',
]

/**
 * The event types the history log H3 added (D26): the fields a replay knows
 * exactly only from the `historyLogSince` day on.
 */
export const H3_EVENT_TYPES: readonly TodoEventType[] = ['followup', 'followedUp', 'marker', 'person', 'tag']

export interface TodoEvent {
  id?: number
  todoId: number
  type: TodoEventType
  fromValue: string | number | null
  toValue: string | number | null
  /** ISO timestamp. */
  timestamp: string
}

/** A task's stored priority flags, as a `marker` event logs them. */
export interface MarkerFlags {
  urgent: boolean
  important: boolean
  focus: boolean
}

const MARKER_FLAG_ORDER = ['urgent', 'important', 'focus'] as const

/** A `marker` event's value for `flags`: the set ones' names, comma-joined in a fixed order; `null` for none. */
export function encodeMarkerFlags(flags: { urgent?: boolean; important?: boolean; focus?: boolean }): string | null {
  const set = MARKER_FLAG_ORDER.filter((k) => flags[k] === true)
  return set.length === 0 ? null : set.join(',')
}

/** The flags a `marker` event's value names (anything else reads as no flag). */
export function decodeMarkerFlags(value: string | number | null): MarkerFlags {
  const names = typeof value === 'string' ? new Set(value.split(',')) : new Set<string>()
  return { urgent: names.has('urgent'), important: names.has('important'), focus: names.has('focus') }
}
