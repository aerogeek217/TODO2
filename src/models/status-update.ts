/**
 * A status update: a dated line of text on a task — what happened, as of
 * that day. A task has any number of them, newest first; they take the
 * place of the one-line Progress field (schema v72). The Status picker
 * (`TodoItem.statusId`) is a separate field.
 *
 * Backing store: `db.statusUpdates` (Dexie v72, `++id, todoId, date`).
 */
export interface StatusUpdate {
  id?: number
  todoId: number
  /** The day it happened — a calendar day at local midnight, never after today. */
  date: Date
  /** One line, trimmed, 1–500 characters (Progress's cap). */
  text: string
  /** When it was written: orders entries of the same day (newest first). */
  createdAt: Date
  /** Added together with a Mark followed up (popover, check-in reply). Only `true` is stored. */
  followedUp?: true
}

export type PersistedStatusUpdate = StatusUpdate & { id: number }

/** The longest text an entry holds (Progress's cap). */
export const STATUS_UPDATE_TEXT_MAX = 500

/**
 * An entry not written yet: one typed into the new-task editor before
 * Create (or carried by a task draft), written with the task.
 */
export type StatusUpdateDraft = Pick<StatusUpdate, 'date' | 'text' | 'createdAt'>
