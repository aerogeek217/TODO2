import type { PersistedTodoItem } from '../../../models'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'

/**
 * The tasks a task drag moves, as the store has them now: the dragged task —
 * or, when it is one of several selected rows of the widget it was dragged
 * from (`listTabId` on the drag data = that widget's selection scope), the
 * whole selection.
 */
export function dragTasks(activeData: Record<string, unknown> | null | undefined): PersistedTodoItem[] {
  const dragged = activeData?.todo as PersistedTodoItem | undefined
  if (!dragged) return []
  const todos = useTodoStore.getState().todos
  const byId = new Map(todos.map((t) => [t.id, t]))
  const ui = useUIStore.getState()
  const scope = typeof activeData?.listTabId === 'string' ? activeData.listTabId : null
  if (scope != null && ui.selectionScope === scope && ui.selectedTodoIds.size > 1 && ui.selectedTodoIds.has(dragged.id)) {
    const out: PersistedTodoItem[] = []
    for (const id of ui.selectedTodoIds) {
      const t = byId.get(id)
      if (t) out.push(t)
    }
    return out
  }
  return [byId.get(dragged.id) ?? dragged]
}
