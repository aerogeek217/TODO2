import type { TodoItem } from '../models'
import { ALL_ROW_FIELDS, type RowFieldsUsed } from './task-row-columns'

/** What a row shows for a task beyond its own fields: its people, tags and notes / status update. */
interface RowFieldLookups {
  hasPeople: (todoId: number) => boolean
  hasTags: (todoId: number) => boolean
  /** The notes cell is filled: notes or a newest status update with text (`statusNotesPreview`). */
  hasNotes: (todo: Pick<TodoItem, 'notes'> & { id: number }) => boolean
}

/**
 * Which row fields any of `todos` uses (flair P8): a field none of them has
 * gets no column in their list. Stops looking once every field is used.
 */
export function rowFieldsUsed(todos: Iterable<Pick<TodoItem, 'notes' | 'dueDate' | 'nextFollowupAt' | 'statusId'> & { id: number }>, lookups: RowFieldLookups): RowFieldsUsed {
  let notes = false
  let people = false
  let tags = false
  let due = false
  let followup = false
  let status = false
  for (const todo of todos) {
    if (!notes && lookups.hasNotes(todo)) notes = true
    if (!people && lookups.hasPeople(todo.id)) people = true
    if (!tags && lookups.hasTags(todo.id)) tags = true
    if (!due && todo.dueDate != null) due = true
    if (!followup && todo.nextFollowupAt != null) followup = true
    if (!status && todo.statusId != null && todo.statusId !== 0) status = true
    if (notes && people && tags && due && followup && status) return ALL_ROW_FIELDS
  }
  return { notes, people, tags, due, followup, status }
}
