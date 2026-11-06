import { useTodoStore } from '../stores/todo-store'
import { newTaskDefaultFollowup, useSettingsStore } from '../stores/settings-store'

/**
 * Creates one task titled `title` through the store's create path
 * (`addMany`, as Quick Add, the editor and the notes do), with what a new
 * task starts with — Settings' default status and next follow-up — as one
 * undo step `Add "<title>"`. Resolves its id; rejects when it wasn't stored.
 */
export async function addTask(title: string): Promise<number> {
  const now = new Date()
  const defaultStatusId = useSettingsStore.getState().defaultStatusId
  const nextFollowupAt = newTaskDefaultFollowup(now)
  const [id] = await useTodoStore.getState().addMany([{
    todo: {
      title,
      isCompleted: false,
      createdAt: now,
      modifiedAt: now,
      ...(nextFollowupAt && { nextFollowupAt }),
      ...(defaultStatusId != null && { statusId: defaultStatusId }),
    },
    personIds: [],
    tagIds: [],
  }], { description: `Add "${title}"` })
  if (id == null) throw new Error('The new task was not stored')
  return id
}
