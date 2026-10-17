import { usePersonStore } from '../stores/person-store'
import { defaultNextFollowup } from '../stores/settings-store'
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
 * follow-up choice get the Settings default. Returns the created tasks in
 * draft order.
 */
export async function createTasksFromDrafts(
  drafts: readonly TaskDraft[],
  options: { description: string; snackbar?: boolean },
): Promise<CreatedTask[]> {
  if (drafts.length === 0) return []
  const now = new Date()
  const defaultFollowup = defaultNextFollowup(now)
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
  return ids.map((id, i) => ({ id, title: drafts[i]?.title ?? '' }))
}
