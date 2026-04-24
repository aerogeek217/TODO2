import type { ReactNode } from 'react'
import {
  useDraggable,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import type { Transform } from '@dnd-kit/utilities'
import type { PersistedTodoItem } from '../../../models'
import {
  TASK_DRAG_KIND,
  taskDragId,
  type TaskDragKind,
  type TaskSurfaceKey,
} from '../../../utils/task-dnd'

interface SharedProps {
  todo: PersistedTodoItem
  /** Which surface is rendering the row. Determines the emitted drag id. */
  surface: TaskSurfaceKey
  /** Required when `surface === 'taskboard-float'`. Differentiates a todo
   * rendered in multiple floating taskboard widgets on the same canvas. */
  floatingId?: number
  /** Drag data `type`. Defaults to `TASK_DRAG_KIND.task`; taskboard entries
   * pass `TASK_DRAG_KIND.taskboardTask` so the canvas handlers can
   * distinguish "reorder within board / remove on drop-off" from plain task
   * drops. */
  kind?: TaskDragKind
  /** Extra fields merged into the drag data payload. `type` and `todo` are
   * always set by this component and override any same-named keys here. */
  extraData?: Record<string, unknown>
  disabled?: boolean
}

interface DraggableRenderArgs {
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
  setNodeRef: (node: HTMLElement | null) => void
  isDragging: boolean
}

interface SortableRenderArgs extends DraggableRenderArgs {
  transform: Transform | null
  transition: string | undefined
}

export interface TaskDraggableProps extends SharedProps {
  children: (args: DraggableRenderArgs) => ReactNode
}

/**
 * Shared `useDraggable` wrapper. Owns the id + data payload shape so every
 * surface that renders a draggable task row emits identical ids (per
 * `taskDragId`) and identical `data.type` values. Extracted in Phase 4 of the
 * DnD unification — replaces the four hand-rolled per-surface wrappers
 * (`DraggableTaskRow`, `TaskList.DraggableRow`, `DashboardDraggableRow`, and
 * the taskboard sortable entries).
 *
 * Render-prop API: the caller keeps control over the wrapper DOM (classNames,
 * placeholder variants, opacity, data-* attrs) — this component only owns id
 * generation, the drag data payload, and the dnd-kit call.
 */
export function TaskDraggable({
  todo,
  surface,
  floatingId,
  kind,
  extraData,
  disabled,
  children,
}: TaskDraggableProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: taskDragId(surface, todo.id, { floatingId }),
    data: { ...extraData, type: kind ?? TASK_DRAG_KIND.task, todo },
    disabled,
  })
  return <>{children({ attributes, listeners, setNodeRef, isDragging })}</>
}

export interface SortableTaskDraggableProps extends SharedProps {
  children: (args: SortableRenderArgs) => ReactNode
}

/**
 * Sortable variant of {@link TaskDraggable}. Same payload contract, wrapping
 * `useSortable` instead of `useDraggable` so the caller's surface ends up
 * inside a `SortableContext`'s reorder flow. Used by canvas project rows and
 * taskboard entries; Phase 6 extends this to the main taskboard drop path so
 * insertion index comes from dnd-kit rather than a DOM query.
 */
export function SortableTaskDraggable({
  todo,
  surface,
  floatingId,
  kind,
  extraData,
  disabled,
  children,
}: SortableTaskDraggableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    transform,
    transition,
  } = useSortable({
    id: taskDragId(surface, todo.id, { floatingId }),
    data: { ...extraData, type: kind ?? TASK_DRAG_KIND.task, todo },
    disabled,
  })
  return <>{children({ attributes, listeners, setNodeRef, isDragging, transform, transition })}</>
}
