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
   * the row; the "Focus" list (predicate `focus: true`, manual order) lists
   * them. Absent = not in focus.
   */
  focus?: boolean
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
