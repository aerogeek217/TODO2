import type { StatusUpdate, Subtask } from '../models'
import { usePersonStore } from '../stores/person-store'
import { newTaskDefaultFollowup } from '../stores/settings-store'
import { useStatusUpdateStore } from '../stores/status-update-store'
import { useSubtaskStore } from '../stores/subtask-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { resolveTags, resolveUnmatchedPeople } from './nlp-resolver'
import { draftToTodo, type TaskDraft } from './task-draft'

export interface CreatedTask {
  id: number
  title: string
}

/**
 * Creates tasks from drafts, in order, as one undo step. People and tags the
 * drafts name that don't exist yet are created first (lookup-or-create; like
 * every create of a person or tag, that part isn't undone). Tasks without a
 * follow-up choice get the Settings default (none while new tasks get no
 * follow-up). A draft's status updates and subtasks are written after its
 * task, with no undo step of their own (the create's undo takes them, its
 * redo puts them back); best effort — a task that exists is never reported
 * as not created. Returns the created tasks in draft order.
 */
export async function createTasksFromDrafts(
  drafts: readonly TaskDraft[],
  options: { description: string; snackbar?: boolean },
): Promise<CreatedTask[]> {
  if (drafts.length === 0) return []
  const now = new Date()
  const defaultFollowup = newTaskDefaultFollowup(now)
  const items = []
  for (const draft of drafts) {
    const newPersonIds = draft.newPeople.length > 0
      ? await resolveUnmatchedPeople(draft.newPeople, { personStore: usePersonStore.getState() })
      : []
    const newTagIds = draft.newTags.length > 0
      ? await resolveTags(draft.newTags, { tagStore: useTagStore.getState() })
      : []
    items.push({
      todo: draftToTodo(draft, now, defaultFollowup),
      personIds: [...new Set([...draft.personIds, ...newPersonIds])],
      tagIds: [...new Set([...draft.tagIds, ...newTagIds])],
    })
  }
  const ids = await useTodoStore.getState().addMany(items, options)
  const updates: StatusUpdate[] = ids.flatMap((todoId, i) => (drafts[i]?.statusUpdates ?? [])
    .map((u) => ({ todoId, date: u.date, text: u.text, createdAt: u.createdAt })))
  if (updates.length > 0) {
    await useStatusUpdateStore.getState().addRows(updates).catch((e: unknown) => {
      console.warn('[note-tasks] writing the new tasks’ status updates failed', e)
    })
  }
  const subtasks: Subtask[] = ids.flatMap((todoId, i) => (drafts[i]?.subtasks ?? [])
    .map((s, k) => ({ todoId, title: s.title, isCompleted: s.isCompleted, sortOrder: k, createdAt: now })))
  if (subtasks.length > 0) {
    await useSubtaskStore.getState().addRows(subtasks).catch((e: unknown) => {
      console.warn('[note-tasks] writing the new tasks’ subtasks failed', e)
    })
  }
  return ids.map((id, i) => ({ id, title: drafts[i]?.title ?? '' }))
}
