import { usePersonStore } from '../stores/person-store'
import { newTaskDefaultFollowup, useSettingsStore } from '../stores/settings-store'
import { useStatusStore } from '../stores/status-store'
import { useStatusUpdateStore } from '../stores/status-update-store'
import { useSubtaskStore } from '../stores/subtask-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { useUIStore } from '../stores/ui-store'
import { useUndoStore, type UndoGroupToken } from '../stores/undo-store'
import { formatDateNumeric } from '../utils/date'
import { shortTitle as short } from '../utils/text'
import { compareSubtasks } from '../utils/subtasks'

/**
 * Converting both ways between a task and a subtask (cr28, T3).
 *
 * - **Make subtask of…**: a task becomes one line of another task's
 *   checklist, keeping only its title and done state; its own subtasks move
 *   to the new parent; everything else goes with the task (a prompt lists
 *   it, unless the task holds nothing but its title). One undo step brings
 *   the task back whole.
 * - **Make a task**: a subtask leaves the checklist and becomes a task with
 *   its title and done state, the parent's people and tags copied, and what
 *   every new task gets (Settings' default status and next follow-up). One
 *   undo step takes both back.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * What making task `todoId` a subtask drops — each as a short phrase for
 * the prompt (`Due 11/20`, `2 people`, `Status: Waiting`, `3 status
 * updates`, `Notes`…); empty when the task holds nothing but its title.
 */
export function droppedFields(todoId: number): string[] {
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
  if (!todo) return []
  const out: string[] = []
  if (todo.dueDate) out.push(`Due ${formatDateNumeric(todo.dueDate)}`)
  if (todo.recurrenceRule) out.push('Repeats')
  if (todo.nextFollowupAt) out.push(`Next follow-up ${formatDateNumeric(todo.nextFollowupAt)}`)
  if (todo.lastFollowupAt) out.push(`Last follow-up ${formatDateNumeric(todo.lastFollowupAt)}`)
  const people = usePersonStore.getState().assignedPeopleMap.get(todoId) ?? []
  if (people.length === 1 && people[0]) out.push(people[0].name)
  else if (people.length > 1) out.push(`${people.length} people`)
  const tags = useTagStore.getState().assignedTagsMap.get(todoId) ?? []
  if (tags.length === 1 && tags[0]) out.push(`#${tags[0].name}`)
  else if (tags.length > 1) out.push(plural(tags.length, 'tag', 'tags'))
  const status = todo.statusId != null ? useStatusStore.getState().statuses.find((s) => s.id === todo.statusId) : undefined
  if (status) out.push(`Status: ${status.name}`)
  const markers = [todo.focus && 'Focus', todo.urgent && 'Urgent', todo.important && 'Important'].filter((m): m is string => typeof m === 'string')
  out.push(...markers)
  const updates = useStatusUpdateStore.getState().byTodo.get(todoId)?.length ?? 0
  if (updates > 0) out.push(plural(updates, 'status update', 'status updates'))
  if (todo.notes && todo.notes.trim() !== '') out.push('Notes')
  return out
}

/** The prompt for a conversion that drops `dropped` (and moves `ownSubtasks` subtasks). */
export function makeSubtaskPrompt(title: string, parentTitle: string, dropped: readonly string[], ownSubtasks: number) {
  const moved = ownSubtasks > 0 ? ` Its ${plural(ownSubtasks, 'subtask moves', 'subtasks move')} to “${short(parentTitle)}” too.` : ''
  return {
    title: `Make “${short(title)}” a subtask of “${short(parentTitle)}”?`,
    message: `A subtask is a line of “${short(parentTitle)}”’s checklist: it keeps its title and whether it’s done. These go with the task: ${dropped.join(' · ')}.${moved}`,
    confirmLabel: 'Make subtask',
  }
}

/**
 * Makes task `todoId` a subtask of task `parentId`: asks first when the task
 * holds more than its title (`droppedFields`), then, as one undo step named
 * `Made “X” a subtask of “Y”`: its own subtasks move to the parent (after
 * the parent's own), a subtask with its title and done state is added last,
 * and the task is deleted. Resolves whether it was done (false: cancelled,
 * or a task missing). A failed write takes back what was written and says
 * so.
 */
export async function makeSubtaskOf(todoId: number, parentId: number): Promise<boolean> {
  const todos = useTodoStore.getState().todos
  const todo = todos.find((t) => t.id === todoId)
  const parent = todos.find((t) => t.id === parentId)
  if (!todo || !parent || todo.id === parent.id) return false
  const own = [...(useSubtaskStore.getState().byTodo.get(todo.id) ?? [])].sort(compareSubtasks)
  const dropped = droppedFields(todo.id)
  if (dropped.length > 0) {
    const ok = await useUIStore.getState().askConfirmation(makeSubtaskPrompt(todo.title, parent.title, dropped, own.length))
    if (!ok) return false
  }
  const name = `Made “${short(todo.title)}” a subtask of “${short(parent.title)}”`
  return useUndoStore.getState().runGroup(name, async (group) => {
    const subtasks = useSubtaskStore.getState()
    for (const s of own) {
      if (!await subtasks.moveToTask(s.id, parent.id)) return fail(group, name)
    }
    const added = await subtasks.add(parent.id, todo.title, { done: todo.isCompleted })
    if (!added) return fail(group, name)
    try {
      await useTodoStore.getState().remove(todo.id)
    } catch {
      return fail(group, name)
    }
    return true
  })
}

/** Takes back the group's writes and says so; false. */
async function fail(group: UndoGroupToken, name: string): Promise<false> {
  const clean = await useUndoStore.getState().abortGroup(group, name)
  useUndoStore.getState().notify(clean ? 'Couldn’t make it a subtask. Nothing changed.' : 'Couldn’t make it a subtask. Undo takes back what was done.')
  return false
}

/**
 * Makes subtask `subtaskId` a task: as one undo step named `Made “X” a
 * task`, a task with its title and done state (completed now when done),
 * the parent's people and tags copied, Settings' default status and next
 * follow-up (what every new task gets), is added and the subtask removed.
 * Resolves the new task's id, or null when nothing was done.
 */
export async function makeTaskFromSubtask(subtaskId: number): Promise<number | null> {
  let sub: { id: number; todoId: number; title: string; isCompleted: boolean } | undefined
  for (const rows of useSubtaskStore.getState().byTodo.values()) {
    sub = rows.find((r) => r.id === subtaskId)
    if (sub) break
  }
  if (!sub) return null
  const parentId = sub.todoId
  const personIds = (usePersonStore.getState().assignedPeopleMap.get(parentId) ?? []).flatMap((p) => (p.id != null ? [p.id] : []))
  const tagIds = (useTagStore.getState().assignedTagsMap.get(parentId) ?? []).flatMap((t) => (t.id != null ? [t.id] : []))
  const name = `Made “${short(sub.title)}” a task`
  const { id, title, isCompleted } = sub
  try {
    return await useUndoStore.getState().runGroup(name, async (group) => {
      const now = new Date()
      const defaultStatusId = useSettingsStore.getState().defaultStatusId
      const nextFollowupAt = newTaskDefaultFollowup(now)
      // Created open (a new row is never stored completed), then completed
      // in the same step when the subtask was done.
      const [created] = await useTodoStore.getState().addMany([{
        todo: {
          title,
          isCompleted: false,
          createdAt: now,
          modifiedAt: now,
          ...(nextFollowupAt && !isCompleted ? { nextFollowupAt } : {}),
          ...(defaultStatusId != null ? { statusId: defaultStatusId } : {}),
        },
        personIds,
        tagIds,
      }], { description: name })
      if (created == null) {
        await useUndoStore.getState().abortGroup(group, name)
        return null
      }
      if (isCompleted) await useTodoStore.getState().update(created, { isCompleted: true })
      if (!await useSubtaskStore.getState().remove(id)) {
        const clean = await useUndoStore.getState().abortGroup(group, name)
        useUndoStore.getState().notify(clean ? 'Couldn’t make it a task. Nothing changed.' : 'Couldn’t make it a task. Undo takes back what was done.')
        return null
      }
      return created
    })
  } catch (e) {
    console.error('[subtask-convert] the subtask could not become a task', e)
    useUndoStore.getState().notify(`Couldn’t make “${short(title)}” a task.`)
    return null
  }
}
