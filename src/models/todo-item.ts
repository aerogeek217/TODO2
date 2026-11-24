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
   * "Mark followed up" action, or to a day (local midnight) when edited by hand.
   * Never in the future.
   */
  lastFollowupAt?: Date
  /**
   * When to follow up next — a calendar day stored at local midnight. While
   * Settings' "Set a next follow-up automatically" is on, new tasks get today +
   * the default interval (`followupDefaultInterval`) and "Mark followed up"
   * moves it there; off, new tasks get none and Mark followed up clears it.
   * Optional: clearing it leaves the task with no follow-up.
   */
  nextFollowupAt?: Date
  /**
   * The planned day: the day the user plans to work on the task — a
   * calendar day stored at local midnight. Shown and set in the Planner;
   * filters (the `planned` date type), list sorts and groups read it, no
   * row column or Markdown export does. It is the task's **plan state**:
   * a planned day, or none. Planning is
   * not an edit of the task: a plan write never stamps `modifiedAt`
   * (`todo-store.setPlan`, `KEEP_STAMPS`) and logs no history event, and it
   * never changes a due date or a follow-up. Completing a repeating task
   * clears it on the next occurrence; Duplicate doesn't copy it. Not
   * indexed. Absent = no planned day (schema v85).
   */
  doDate?: Date
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

/** A task's plan state in the Planner: a planned day (`doDate`), or — `null` — none. */
export type TaskPlan = { day: Date } | null

/** One task's plan to write (`todo-store.setPlans`). */
export interface TaskPlanChange {
  id: number
  plan: TaskPlan
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
