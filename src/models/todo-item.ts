import { Priority } from './priority'
import type { RecurrenceRule } from './recurrence'

export interface TodoItem {
  id?: number
  title: string
  notes?: string
  progress?: string
  priority: Priority
  isCompleted: boolean
  isStarred: boolean
  isAssigned?: boolean
  dueDate?: Date
  isHardDeadline?: boolean
  recurrenceRule?: RecurrenceRule
  createdAt: Date
  modifiedAt: Date
  projectId?: number
  canvasId?: number
  parentId?: number
  sortOrder: number
}

/** TodoItem after persistence — id is always defined. */
export type PersistedTodoItem = TodoItem & { id: number }
