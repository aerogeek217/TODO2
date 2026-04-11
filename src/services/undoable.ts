import { useUndoStore } from '../stores/undo-store'

/**
 * Execute an action and register it as undoable.
 * Skips registration when the undo store is already performing an undo/redo.
 */
export function undoable(
  description: string,
  doFn: () => void | Promise<void>,
  undoFn: () => void | Promise<void>,
  showSnackbar = false,
): void {
  if (useUndoStore.getState().isPerformingUndoRedo) return

  useUndoStore.getState().push(
    { description, undo: undoFn, redo: doFn },
    showSnackbar,
  )
}
