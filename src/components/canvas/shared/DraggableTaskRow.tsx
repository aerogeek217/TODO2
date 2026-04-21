import { useDraggable } from '@dnd-kit/core'
import type { PersistedTodoItem, Person } from '../../../models'
import { TaskRow } from '../../task/TaskRow'

interface DraggableTaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  onOpenDetail?: (todoId: number) => void
  /** Extra prefix for the draggable id. Useful when the same todo is rendered
   * by two surfaces simultaneously (e.g. a lens slot + an inset) so the ids
   * don't collide inside the shared `DndContext`. */
  idPrefix?: string
  /** Render as the context-showing row variant (rail lens / search). */
  showContext?: boolean
  compact?: boolean
}

/**
 * Wraps `TaskRow` with `useDraggable({ data: { type: 'task', todo } })` so the
 * row rides the surrounding canvas `DndContext`. Extracted from `ListInsetNode`
 * in widget-taskboard-dnd P3 so the rail lens (`LensSlotContent`) can share
 * the same draggable behavior via `ListDefinitionBody.renderRow`.
 */
export function DraggableTaskRow({
  todo,
  assignedPeople,
  onOpenDetail,
  idPrefix = 'inset',
  showContext,
  compact = true,
}: DraggableTaskRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${idPrefix}-todo-${todo.id}`,
    data: { type: 'task', todo },
  })

  return (
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
  )
}
