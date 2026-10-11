import type { PersistedTodoItem, Person } from '../../../models'
import { TaskRow } from '../TaskRow'
import { TaskDraggable } from './TaskDraggable'
import type { TaskSurfaceKey } from '../../../utils/task-dnd'

interface DraggableTaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  onOpenDetail?: (todoId: number) => void
  /** Which surface is rendering the row (decides the drag id). */
  surface?: Extract<TaskSurfaceKey, 'status-widget'>
  /** Render as the context-showing row variant. */
  showContext?: boolean
}

/**
 * Wraps `TaskRow` with the shared `TaskDraggable` primitive so the row rides
 * the surrounding workspace `DndContext` (e.g. onto a calendar day).
 */
export function DraggableTaskRow({
  todo,
  assignedPeople,
  onOpenDetail,
  surface = 'status-widget',
  showContext,
}: DraggableTaskRowProps) {
  return (
    <TaskDraggable todo={todo} surface={surface}>
      {({ attributes, listeners, setNodeRef, isDragging }) => (
        <div
          ref={setNodeRef}
          data-task-drag-id={todo.id}
          style={{ outline: 'none', opacity: isDragging ? 0 : undefined }}
          {...attributes}
          {...listeners}
        >
          <TaskRow
            todo={todo}
            assignedPeople={assignedPeople}
            onOpenDetail={onOpenDetail ? () => onOpenDetail(todo.id) : undefined}
            showContext={showContext}
          />
        </div>
      )}
    </TaskDraggable>
  )
}
