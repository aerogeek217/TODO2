import type { PersistedTodoItem, RecurrenceType, TodoChanges } from '../../models'
import { makeRecurrenceRule } from '../../utils/recurrence'
import { sameFieldValue } from '../../utils/todo-changes'

/**
 * The task editor's own copies of a task's fields (edit mode). The editor
 * keeps a baseline — the task's values when the editor last synced with the
 * store — so it can tell the user's changes from changes made elsewhere.
 */
export interface EditorFields {
  title: string
  notes: string
  progress: string
  statusId: number | undefined
  deadline: Date | null
  recurrenceType: RecurrenceType | ''
}

type EditorField = keyof EditorFields

const FIELDS: readonly EditorField[] = ['title', 'notes', 'progress', 'statusId', 'deadline', 'recurrenceType']

/** A stored task's values in the editor's terms. */
export function editorFieldsOf(
  todo: Pick<PersistedTodoItem, 'title' | 'notes' | 'progress' | 'statusId' | 'dueDate' | 'recurrenceRule'>,
): EditorFields {
  return {
    title: todo.title,
    notes: todo.notes ?? '',
    progress: todo.progress ?? '',
    statusId: todo.statusId,
    deadline: todo.dueDate ?? null,
    recurrenceType: todo.recurrenceRule?.type ?? '',
  }
}

/** The fields the user changed in the editor since the last sync. */
export function editedFields(form: EditorFields, baseline: EditorFields): Set<EditorField> {
  return new Set(FIELDS.filter((f) => !sameFieldValue(form[f], baseline[f])))
}

/**
 * The store's new values the editor should show: fields changed in the store
 * since the last sync that the user hasn't changed in the editor. A field
 * the user is editing keeps the user's value.
 */
export function storeUpdatesToShow(
  store: EditorFields,
  baseline: EditorFields,
  form: EditorFields,
): Partial<EditorFields> {
  const edited = editedFields(form, baseline)
  const out: Partial<Record<EditorField, unknown>> = {}
  for (const f of FIELDS) {
    if (!edited.has(f) && !sameFieldValue(store[f], baseline[f])) out[f] = store[f]
  }
  return out as Partial<EditorFields>
}

/**
 * What saving the editor writes: only the fields the user changed since the
 * last sync, so a change made elsewhere meanwhile is never written back over.
 * An emptied title is not saved; the repeat rule is rebuilt when the repeat
 * or the due date it anchors to changed.
 */
export function editorChanges(form: EditorFields, baseline: EditorFields): TodoChanges {
  const edited = editedFields(form, baseline)
  const changes: TodoChanges = {}
  const title = form.title.trim()
  if (edited.has('title') && title) changes.title = title
  if (edited.has('notes')) changes.notes = form.notes || undefined
  if (edited.has('progress')) changes.progress = form.progress || undefined
  if (edited.has('statusId')) changes.statusId = form.statusId
  if (edited.has('deadline')) changes.dueDate = form.deadline ?? undefined
  if (edited.has('recurrenceType') || edited.has('deadline')) {
    changes.recurrenceRule = form.recurrenceType && form.deadline
      ? makeRecurrenceRule(form.recurrenceType, form.deadline)
      : undefined
  }
  return changes
}
