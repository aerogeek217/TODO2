import { todoRepository } from '../data/todo-repository'
import { UndoGone } from './undo-store'

/**
 * The guard of an undo / redo that writes to tasks (`todoIds`): when none of
 * them exists any more — deleted with no undo step of its own, by a purge of
 * completed tasks — it throws `UndoGone`, so the entry is dropped with a
 * notice instead of "undoing" nothing (cr31 stores L6). Resolves the ones
 * that exist.
 */
export async function requireTasks(todoIds: Iterable<number>): Promise<number[]> {
  const ids = [...new Set(todoIds)]
  if (ids.length === 0) return []
  const present = await todoRepository.existingIds(ids)
  if (present.length > 0) return present
  throw new UndoGone(ids.length === 1 ? 'That task was deleted.' : 'Those tasks were deleted.')
}

/**
 * `step`, run only once `requireTasks(todoIds)` passes — given the tasks
 * that still exist, so a step over several writes to no deleted one.
 */
export function guardTasks(todoIds: Iterable<number>, step: (present: number[]) => void | Promise<void>): () => Promise<void> {
  const ids = [...todoIds]
  return async () => {
    await step(await requireTasks(ids))
  }
}
