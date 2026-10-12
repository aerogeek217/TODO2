import type { ReactNode } from 'react'
import {
  useDraggable,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core'
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
  /** Required when `surface === 'list-widget'`: the widget's tab id and the
   * group the row shows in (see `taskDragId`). */
  scope?: string
  sectionKey?: string
  /** Drag data `type`. Defaults to `TASK_DRAG_KIND.task`. */
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

export interface TaskDraggableProps extends SharedProps {
  children: (args: DraggableRenderArgs) => ReactNode
}

/**
 * Shared `useDraggable` wrapper. Owns the id + data payload shape so every
 * surface that renders a draggable task row emits identical ids (per
 * `taskDragId`) and identical `data.type` values, instead of hand-rolled
 * per-surface wrappers.
 *
 * Render-prop API: the caller keeps control over the wrapper DOM (classNames,
 * placeholder variants, opacity, data-* attrs) — this component only owns id
 * generation, the drag data payload, and the dnd-kit call.
 */
export function TaskDraggable({
  todo,
  surface,
  scope,
  sectionKey,
  kind,
  extraData,
  disabled,
  children,
}: TaskDraggableProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: taskDragId(surface, todo.id, { scope, sectionKey }),
    data: { ...extraData, type: kind ?? TASK_DRAG_KIND.task, todo },
    disabled,
  })
  return <>{children({ attributes, listeners, setNodeRef, isDragging })}</>
}
