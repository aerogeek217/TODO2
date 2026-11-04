import { makeTaskFromSubtask } from '../../../services/subtask-convert'
import { useUIStore } from '../../../stores/ui-store'
import type { MenuEntry } from '../../shared/MenuPopover'
import type { ChecklistItem } from './SubtaskChecklist'

/**
 * A stored subtask's ⋯ items beyond Rename and Delete (cr28, T3): **Make a
 * task** (`makeTaskFromSubtask`) and **Move to another task…** (the task
 * picker). Not for the editor's create mode, whose rows aren't stored yet.
 */
export function storedSubtaskMenuEntries(item: ChecklistItem): MenuEntry[] {
  return [
    { kind: 'item', label: 'Make a task', onSelect: () => { void makeTaskFromSubtask(item.id) } },
    { kind: 'item', label: 'Move to another task…', onSelect: () => useUIStore.getState().openTaskPicker({ kind: 'move-subtask', subtaskId: item.id }) },
  ]
}
