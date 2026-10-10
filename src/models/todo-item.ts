import type { RecurrenceRule } from './recurrence'
import type { ScheduledValue } from './scheduled-value'

export interface TodoItem {
  id?: number
  /**
   * Stable identity that survives export / import (cr1 P4). Unique across
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
  scheduledDate?: ScheduledValue
  /** Deadline — UI label is "Deadline". */
  dueDate?: Date
  recurrenceRule?: RecurrenceRule
  createdAt: Date
  modifiedAt: Date
  projectId?: number
  canvasId?: number
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
