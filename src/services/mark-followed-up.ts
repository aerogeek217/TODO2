import { useStatusUpdateStore } from '../stores/status-update-store'
import { useTodoStore, type MarkFollowedUpOptions } from '../stores/todo-store'
import { useUndoStore } from '../stores/undo-store'
import { formatDateNumeric, startOfDay, startOfToday } from '../utils/date'
import { statusUpdateDay, statusUpdateText } from '../utils/status-updates'

/** The undo step's name for a follow-up recorded with a status update (`at`: dated back, that day). */
export function followedUpWithUpdateName(count: number, at?: Date): string {
  const day = at ? ` ${formatDateNumeric(at)}` : ''
  return count === 1 ? `Followed up${day} · status update added` : `Followed up ${count} tasks${day} · status update added`
}

/**
 * "Mark followed up" on `ids` (`todo-store.markFollowedUp` with `options`),
 * with the follow-up popover's optional **Status update** line: when
 * `update` has text, every task also gets that entry, dated today (`options.at`
 * when given) and `followedUp` — both as one undo step (`runGroup`). Without text it is
 * exactly Mark followed up (and rejects as it does). With text it never
 * rejects: when either write fails, what the other wrote is taken back
 * (`abortGroup`) and a notice says so (the entry's failure is the store's
 * own notice).
 */
export async function markFollowedUpWithUpdate(
  ids: readonly number[],
  options: MarkFollowedUpOptions = {},
  update = '',
): Promise<void> {
  const text = statusUpdateText(update)
  const todoIds = [...ids]
  if (text === '') return useTodoStore.getState().markFollowedUp(todoIds, options)
  const known = new Set(useTodoStore.getState().todos.map((t) => t.id))
  const targets = todoIds.filter((id) => known.has(id))
  if (targets.length === 0) return
  const name = followedUpWithUpdateName(targets.length, options.at)
  await useUndoStore.getState().runGroup(name, async (group) => {
    const added = await useStatusUpdateStore.getState()
      .addToMany(targets, { date: options.at ?? new Date(), text, followedUp: true }, name)
    if (added.length === 0) {
      // Not written (the store said so): nothing else is either.
      await useUndoStore.getState().abortGroup(group, name)
      return
    }
    try {
      await useTodoStore.getState().markFollowedUp(targets, options)
    } catch {
      const clean = await useUndoStore.getState().abortGroup(group, name)
      useUndoStore.getState().notify(clean
        ? 'Couldn’t mark the tasks followed up. Nothing changed.'
        : 'Couldn’t mark the tasks followed up. Undo takes back the status update.')
    }
  }).catch((e: unknown) => { console.error('[mark-followed-up] the follow-up could not be recorded', e) })
}

/**
 * A status update as the user enters it (the editor's section, the notes
 * popover's Status line): it counts as following up on its day. When that day
 * is after the task's last follow-up, this is Mark followed up for that day —
 * `lastFollowupAt` is the day (today: now), the next follow-up moves by its
 * rule — with the entry `followedUp`, as one undo step with the snackbar.
 * A day no later than the last follow-up only adds the entry (its own quiet
 * undo step). Never rejects; a failure is said as the stores say it.
 */
export async function addStatusUpdate(todoId: number, entry: { date: Date; text: string }): Promise<void> {
  if (statusUpdateText(entry.text) === '') return
  const today = startOfToday()
  const day = statusUpdateDay(entry.date, today)
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
  const last = todo?.lastFollowupAt
  if (!todo || (last && day.getTime() <= startOfDay(last).getTime())) {
    await useStatusUpdateStore.getState().add(todoId, entry)
    return
  }
  await markFollowedUpWithUpdate([todoId], day.getTime() === today.getTime() ? {} : { at: day }, entry.text)
}
