import { useUndoStore } from '../../stores/undo-store'
import { isLayoutEditStep, settleLayoutWrites } from '../../stores/workspace-store'

/** The names of the undo steps of structural layout edits, oldest first (each edit is saved at once as one). */
export function layoutSteps(): string[] {
  return useUndoStore.getState().undoStack.filter(isLayoutEditStep).map((e) => e.description)
}

export { settleLayoutWrites }
