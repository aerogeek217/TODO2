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
}

/** TodoItem after persistence — id is always defined. */
export type PersistedTodoItem = TodoItem & { id: number }
