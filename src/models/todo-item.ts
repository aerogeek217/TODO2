import type { RecurrenceRule } from './recurrence'
import type { ScheduledValue } from './scheduled-value'

export interface TodoItem {
  id?: number
  title: string
  notes?: string
  progress?: string
  isCompleted: boolean
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
  /**
   * Lowercase slugs (`/^[a-z0-9_-]+$/`). Omitted when empty. Authored by
   * `#foo` NLP; display rule (see plan) keeps tags out of task rows — they
   * exist to power search / filter / grouping only.
   */
  tags?: string[]
}

/** TodoItem after persistence — id is always defined. */
export type PersistedTodoItem = TodoItem & { id: number }
