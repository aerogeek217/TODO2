import type { PersistedTodoItem, Person } from '../../../models'
import { TaskRow } from '../../task/TaskRow'
import { TaskDraggable } from '../../task/dnd/TaskDraggable'
import type { TaskSurfaceKey } from '../../../utils/task-dnd'

interface DraggableTaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  onOpenDetail?: (todoId: number) => void
  /** Which surface is rendering the row. Controls id prefix so the same todo
   * rendered on two surfaces simultaneously (e.g. a lens slot + an inset)
   * doesn't collide inside the shared `DndContext`. */
  surface?: Extract<TaskSurfaceKey, 'inset' | 'lens'>
  /** Render as the context-showing row variant (rail lens / search). */
  showContext?: boolean
  compact?: boolean
}

/**
 * Wraps `TaskRow` with the shared `TaskDraggable` primitive so the row rides
 * the surrounding canvas `DndContext`. Extracted from `ListInsetNode` in
 * widget-taskboard-dnd P3 so the rail lens (`LensSlotContent`) can share the
 * same draggable behavior via `ListDefinitionBody.renderRow`; Phase 4 of the
 * DnD unification moved the underlying `useDraggable` call into the shared
 * primitive.
 */
export function DraggableTaskRow({
  todo,
  assignedPeople,
  onOpenDetail,
  surface = 'inset',
  showContext,
  compact = true,
}: DraggableTaskRowProps) {
  return (
    <TaskDraggable todo={todo} surface={surface}>
      {({ attributes, listeners, setNodeRef, isDragging }) => (
        <div
          ref={setNodeRef}
          data-inset-todo-id={todo.id}
          style={{ outline: 'none', opacity: isDragging ? 0 : undefined }}
          {...attributes}
          {...listeners}
        >
          <TaskRow
            todo={todo}
            assignedPeople={assignedPeople}
            onOpenDetail={onOpenDetail ? () => onOpenDetail(todo.id) : undefined}
            showContext={showContext}
            compact={compact}
          />
        </div>
      )}
    </TaskDraggable>
  )
}
