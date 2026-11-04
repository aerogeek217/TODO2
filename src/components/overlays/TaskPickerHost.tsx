import { useEffect, useMemo } from 'react'
import { makeSubtaskOf } from '../../services/subtask-convert'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore, type TaskPickerRequest } from '../../stores/ui-store'
import { TaskPickerDialog } from '../task/subtasks/TaskPickerDialog'

/**
 * Shows the task picker `ui-store.taskPicker` asks for (`openTaskPicker`):
 * "Make subtask of…" for a task (then `makeSubtaskOf`, which may ask first
 * and closes the editor the task was open in), or "Move to another task…"
 * for a subtask (then `moveToTask`). One host, so every surface — a row's
 * menu, a search result's, the editor's footer, a checklist's ⋯ — opens the
 * same dialog without one of its own.
 */
export function TaskPickerHost() {
  const request = useUIStore((s) => s.taskPicker)
  if (!request) return null
  return <OpenTaskPicker request={request} />
}

function OpenTaskPicker({ request }: { request: TaskPickerRequest }) {
  const close = () => useUIStore.getState().closeTaskPicker()
  const todo = useTodoStore((s) => (request.kind === 'make-subtask' ? s.todos.find((t) => t.id === request.todoId) : undefined))
  const subtask = useSubtaskStore((s) => {
    if (request.kind !== 'move-subtask') return undefined
    for (const rows of s.byTodo.values()) {
      const hit = rows.find((r) => r.id === request.subtaskId)
      if (hit) return hit
    }
    return undefined
  })
  // What it was asked for is gone (deleted meanwhile): nothing to pick for.
  const gone = request.kind === 'make-subtask' ? !todo : !subtask
  useEffect(() => { if (gone) useUIStore.getState().closeTaskPicker() }, [gone])
  const excludeIds = useMemo(
    () => new Set([request.kind === 'make-subtask' ? request.todoId : (subtask?.todoId ?? -1)]),
    [request, subtask?.todoId],
  )
  if (gone) return null

  if (request.kind === 'make-subtask' && todo) {
    return (
      <TaskPickerDialog
        title={`Make “${todo.title}” a subtask of…`}
        excludeIds={excludeIds}
        onClose={close}
        onPick={(parentId) => {
          close()
          void makeSubtaskOf(todo.id, parentId).then((done) => {
            const ui = useUIStore.getState()
            if (done && ui.editPopupMode === 'edit' && ui.selectedTodoId === todo.id) ui.closeEditPopup()
          })
        }}
      />
    )
  }
  if (request.kind === 'move-subtask' && subtask) {
    return (
      <TaskPickerDialog
        title={`Move “${subtask.title}” to…`}
        excludeIds={excludeIds}
        onClose={close}
        onPick={(todoId) => {
          close()
          void useSubtaskStore.getState().moveToTask(subtask.id, todoId)
        }}
      />
    )
  }
  return null
}
