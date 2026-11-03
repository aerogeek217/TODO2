import { useStatusUpdateStore } from '../stores/status-update-store'
import { useTodoStore, type MarkFollowedUpOptions } from '../stores/todo-store'
import { useUndoStore } from '../stores/undo-store'
import { statusUpdateText } from '../utils/status-updates'

/** The undo step's name for a follow-up recorded with a status update. */
export function followedUpWithUpdateName(count: number): string {
  return count === 1 ? 'Followed up · status update added' : `Followed up ${count} tasks · status update added`
}

/**
 * "Mark followed up" on `ids` (`todo-store.markFollowedUp` with `options`),
 * with the follow-up popover's optional **Status update** line: when
 * `update` has text, every task also gets that entry, dated today and
 * `followedUp` — both as one undo step (`runGroup`). Without text it is
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
  const name = followedUpWithUpdateName(targets.length)
  await useUndoStore.getState().runGroup(name, async (group) => {
    const added = await useStatusUpdateStore.getState()
      .addToMany(targets, { date: new Date(), text, followedUp: true }, name)
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
