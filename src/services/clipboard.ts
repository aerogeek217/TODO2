import type { PlacementTarget } from './task-placement'

/**
 * Paste cut tasks at a specific target position.
 * Clears the clipboard after pasting.
 *
 * Lazy-imports its store deps so this service module can be loaded by
 * lower-layer callers (utils/data) without dragging the Zustand store graph
 * into their bundle.
 */
export async function pasteTasksAt(target: PlacementTarget): Promise<void> {
  const { useUIStore } = await import('../stores/ui-store')
  const { useTodoStore } = await import('../stores/todo-store')
  const { placeMultipleAt } = await import('./task-placement')

  const { clipboardTodoIds } = useUIStore.getState()
  if (clipboardTodoIds.length === 0) return

  const { todos, applyMutations } = useTodoStore.getState()
  const mutations = placeMultipleAt(todos, new Set(clipboardTodoIds), target)
  if (mutations.length === 0) return
  // Clear only after a successful paste — if applyMutations throws, the
  // clipboard survives so the tasks aren't lost.
  await applyMutations(mutations)
  useUIStore.getState().clearClipboard()
}
