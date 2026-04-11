import { useUIStore } from '../stores/ui-store'
import { useTodoStore } from '../stores/todo-store'
import { placeMultipleAt, type PlacementTarget } from './task-placement'

/**
 * Paste cut tasks at a specific target position.
 * Clears the clipboard after pasting.
 */
export async function pasteTasksAt(target: PlacementTarget): Promise<void> {
  const { clipboardTodoIds } = useUIStore.getState()
  if (clipboardTodoIds.length === 0) return

  const { todos, applyMutations } = useTodoStore.getState()
  const mutations = placeMultipleAt(todos, new Set(clipboardTodoIds), target)
  if (mutations.length === 0) return
  try {
    await applyMutations(mutations)
    useUIStore.getState().clearClipboard()
  } catch (e) {
    // Don't clear clipboard if paste failed — tasks would be lost
    throw e
  }
}
