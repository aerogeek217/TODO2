import { useUndoStore } from './undo-store'

/**
 * Registers an action the caller has already done as an undo step: `undoFn`
 * undoes it, `doFn` redoes it (it is not run now). Skipped while the undo
 * store is performing an undo / redo, so replaying an entry doesn't push a
 * new one.
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
