import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useSettingsStore } from '../stores/settings-store'
import { runNlpMetadataTransaction } from '../data'
import type { TodoItem } from '../models'
import type { FilterDefaults } from '../utils/filter-defaults'
import { resolveTags, resolveUnmatchedPeople, type ResolvedInput } from './nlp-resolver'
import { draftChanges, draftFromEditor, draftFromResolved, type TaskDraft } from './task-draft'

/**
 * Creating one task from Quick Add or the task editor. Both build a
 * `TaskDraft` (`services/task-draft` — the rules every way of creating a
 * task shares; a note's lines go through `services/note-tasks`), then
 * `createTaskFromDraft` stores it.
 */

/**
 * Quick Add's submit: the bar's parsed text, with the defaults of where it
 * was added (`fd` — a list's predicate seed, else the screen filter) filling
 * what the text didn't say. A filter on one status wins over Settings'
 * default status here (`statusDefaultFirst: 'filter'`). Returns the id.
 */
export async function createQuickAddTask(
  submitted: { title: string; resolved: ResolvedInput },
  fd: FilterDefaults,
): Promise<number> {
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
 * anything typed into the title (commands, `@` / `#`). Returns the id.
 */
export async function createEditorTask(
  partial: Partial<TodoItem>,
  assignments: { personIds: readonly number[]; tagIds: readonly number[] },
): Promise<number> {
  const draft = draftFromEditor(partial, assignments, {
    people: usePersonStore.getState().people,
    statuses: useStatusStore.getState().statuses,
    tags: useTagStore.getState().tags,
  })
  return createTaskFromDraft(draft)
}

/**
 * Stores one draft as a new task: added with the store's defaults
 * (`todo-store.add` — its own undo step), then the draft's fields and people
 * in one transaction, then its tags. If that write fails (the store rolls
 * it back and says so), nobody and no tag is assigned and the task stays as
 * added; this never rejects for it. People and tags named but not existing
 * yet are created on the way (lookup-or-create; like every create of a
 * person or tag, not undone).
 */
export async function createTaskFromDraft(draft: TaskDraft): Promise<number> {
  const id = await useTodoStore.getState().add(draft.title)
  const newPersonIds = draft.newPeople.length > 0
    ? await resolveUnmatchedPeople(draft.newPeople, { personStore: usePersonStore.getState() })
    : []
  const personIds = [...new Set([...draft.personIds, ...newPersonIds])]
  const changes = draftChanges(draft)
  const hasChanges = Object.keys(changes).length > 0
  if (hasChanges || personIds.length > 0) {
    try {
      await runNlpMetadataTransaction(async () => {
        if (hasChanges && await useTodoStore.getState().update(id, changes) === false) {
          // Already rolled back and reported; abort so nobody is assigned.
          throw new Error(`Couldn't save task ${id}`)
        }
        for (const personId of personIds) await usePersonStore.getState().assignPerson(id, personId)
      })
    } catch (err) {
      // The task stays as added; its details, people and tags are not set.
      console.warn('[create-task] the new task’s details could not be saved', err)
      return id
    }
  }
  const newTagIds = draft.newTags.length > 0
    ? await resolveTags(draft.newTags, { tagStore: useTagStore.getState() })
    : []
  for (const tagId of new Set([...draft.tagIds, ...newTagIds])) await useTagStore.getState().assignTag(id, tagId)
  return id
}
