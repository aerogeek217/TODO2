/**
 * A subtask (cr28, schema v73): one line of a task's checklist — a title
 * and whether it is done, nothing else (no dates, people, tags, status or
 * notes of its own; one level). It lives purely under its task: never a
 * list row, never counted, filtered, grouped, sorted or searched for on its
 * own (a task is found by its subtasks' words).
 *
 * Backing store: `db.subtasks` (Dexie v73, `++id, todoId`).
 */
export interface Subtask {
  id?: number
  todoId: number
  /** One line, trimmed, 1–500 characters. */
  title: string
  isCompleted: boolean
  /** Its place in the task's checklist (ascending; gaps allowed). */
  sortOrder: number
  createdAt: Date
}

export type PersistedSubtask = Subtask & { id: number }

/** The longest title a subtask holds. */
export const SUBTASK_TITLE_MAX = 500

/**
 * A subtask not written yet: one typed into the new-task editor before
 * Create, or an indented line under a note's bullet, written with the task.
 */
export type SubtaskDraft = Pick<Subtask, 'title' | 'isCompleted'>
