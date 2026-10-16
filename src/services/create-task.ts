import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useSettingsStore } from '../stores/settings-store'
import { useUndoStore } from '../stores/undo-store'
import type { TodoItem } from '../models'
import type { FilterDefaults } from '../utils/filter-defaults'
import type { ResolvedInput } from './nlp-resolver'
import { draftFromEditor, draftFromResolved, type TaskDraft } from './task-draft'
import { createTasksFromDrafts } from './note-tasks'

/**
 * Creating one task from Quick Add or the task editor. Both build a
 * `TaskDraft` (`services/task-draft` — the rules every way of creating a
 * task shares) and store it like a note's lines (`services/note-tasks`).
 */

/**
 * Quick Add's submit: the bar's parsed text, with the defaults of where it
 * was added (`fd` — a list's predicate seed, else the screen filter) filling
 * what the text didn't say. A filter on one status wins over Settings'
 * default status here (`statusDefaultFirst: 'filter'`). Returns the id, or
 * null when it couldn't be stored.
 */
export async function createQuickAddTask(
  submitted: { title: string; resolved: ResolvedInput },
  fd: FilterDefaults,
): Promise<number | null> {
  const draft = draftFromResolved(submitted.resolved, submitted.title, {
    people: usePersonStore.getState().people,
    statuses: useStatusStore.getState().statuses,
    tags: useTagStore.getState().tags,
    defaults: fd,
    defaultStatusId: useSettingsStore.getState().defaultStatusId,
    statusDefaultFirst: 'filter',
  })
  return createTaskFromDraft(draft)
}

/**
 * The task editor's create: its fields and picked people / tags, plus
 * anything typed into the title (commands, `@` / `#`). With its status
 * field cleared the task still gets Settings' default status, as a new task
 * always has from the editor. Returns the id, or null when it couldn't be
 * stored.
 */
export async function createEditorTask(
  partial: Partial<TodoItem>,
  assignments: { personIds: readonly number[]; tagIds: readonly number[] },
): Promise<number | null> {
  const draft = draftFromEditor(partial, assignments, {
    people: usePersonStore.getState().people,
    statuses: useStatusStore.getState().statuses,
    tags: useTagStore.getState().tags,
  })
  const defaultStatusId = useSettingsStore.getState().defaultStatusId
  return createTaskFromDraft(
    draft.statusId === undefined && defaultStatusId != null ? { ...draft, statusId: defaultStatusId } : draft,
  )
}

/**
 * Stores one draft as a new task, as one undo step (`Add "<title>"`): undo
 * removes it with its people and tags, redo puts it back whole — same id,
 * same `created` event (`todo-store.addMany`, as a note's lines are
 * created). People and tags named but not existing yet are created first
 * (lookup-or-create; like every create of a person or tag, not undone).
 * Returns the id, or null when the task couldn't be stored — nothing is
 * created then, the snackbar says so, and this never rejects.
 */
export async function createTaskFromDraft(draft: TaskDraft): Promise<number | null> {
  try {
    const [created] = await createTasksFromDrafts([draft], { description: `Add "${draft.title}"` })
    return created?.id ?? null
  } catch (err) {
    console.warn('[create-task] the task could not be created', err)
    useUndoStore.getState().notify(`Couldn't add "${draft.title}".`)
    return null
  }
}
