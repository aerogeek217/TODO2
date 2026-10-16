import type { RecurrenceRule } from './recurrence'

export interface TodoItem {
  id?: number
  /**
   * Stable identity that survives export / import. Unique across
   * the database (Dexie index `&uid`). Minted on insert (`newTodoUid`);
   * `id` is never reused across databases, so duplicate detection between
   * a file and the live DB keys on `uid`, not `id`.
   */
  uid: string
  title: string
  notes?: string
  progress?: string
  isCompleted: boolean
  /**
   * When the task was last completed. Set on completion, cleared on reopen
   * (`resolveCompletedAt`). The completed-task retention purge keys on this,
   * not `modifiedAt` (which advances on reorders / bulk edits).
   */
  completedAt?: Date
  /** Due date (a day at local midnight). The UI calls it "Due". */
  dueDate?: Date
  /**
   * When the task was last followed up: set to the exact moment by the
   * "Followed up" action, or to a day (local midnight) when edited by hand.
   * Never in the future.
   */
  lastFollowupAt?: Date
  /**
   * When to follow up next — a calendar day stored at local midnight. New
   * tasks get today + the Settings default interval (`followupDefaultInterval`);
   * "Followed up" moves it on by the same interval. Optional: clearing it
   * leaves the task with no follow-up.
   */
  nextFollowupAt?: Date
  recurrenceRule?: RecurrenceRule
  /**
   * On the user's short list of tasks to work on now. Shown as a marker on
   * the row; lists filter on it through the Markers filter (`markers.focus`;
   * the "Focus" list made from the old taskboard is one). Absent = not in focus.
   */
  focus?: boolean
  /**
   * Flagged urgent (red exclamation). Only `true` is stored. A task also
   * counts as urgent when its due date is within the Settings range
   * (`utils/urgency.ts` `isEffectivelyUrgent`) — that never sets this flag.
   */
  urgent?: boolean
  /** Flagged important (yellow star). Only `true` is stored. */
  important?: boolean
  createdAt: Date
  modifiedAt: Date
  statusId?: number
  sortOrder: number
}

/** TodoItem after persistence — id is always defined. */
export type PersistedTodoItem = TodoItem & { id: number }

/**
 * Insert payload: `uid` is optional — `todoRepository.insert` mints one when
 * absent (pass it only to keep an imported task's identity).
 */
export type NewTodoItem = Omit<TodoItem, 'id' | 'uid'> & { uid?: string }

/**
 * An edit to a task: just the fields the editor changed (`undefined` removes
 * a field). The id is passed beside it and `modifiedAt` is stamped by the
 * write, so neither belongs here.
 */
export type TodoChanges = Partial<Omit<TodoItem, 'id' | 'modifiedAt'>>
