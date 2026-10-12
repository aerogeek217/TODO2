/**
 * Canonical `data.type` strings for task-shaped drag payloads. Every surface
 * that drags a plain task row emits `'task'`; the drag id (see `ids.ts`) and
 * any extras in `data` distinguish where the drag came from.
 */
export const TASK_DRAG_KIND = {
  /** Any draggable task row — list widget row (also Eisenhower and dashboard rows), calendar entry. */
  task: 'task',
} as const

export type TaskDragKind = typeof TASK_DRAG_KIND[keyof typeof TASK_DRAG_KIND]

/**
 * Canonical `data.type` strings for drop targets that accept task drags. These
 * are what live on `useDroppable`'s `data` field and what drop handlers read
 * via `event.over.data.current.type`.
 */
export const TASK_DROP_KIND = {
  /** Calendar day cell. The drop data carries `{ date: Date }` (plus the
   * calendar's `dateTypes` and `scope`) so the dispatcher can reschedule
   * without consulting the DOM. */
  calendarDay: 'calendar-day',
  /** An Eisenhower quadrant (header + body, or a stacked section). The drop
   * data carries `{ quadrant, scope }`: dropping a task gives it the
   * quadrant's Urgent / Important flags. */
  eisenhowerQuadrant: 'eisenhower-quadrant',
} as const

export type TaskDropKind = typeof TASK_DROP_KIND[keyof typeof TASK_DROP_KIND]

/** True when a `data.type` value marks a task-shaped drag payload. */
export function isTaskDragKind(v: unknown): v is TaskDragKind {
  return v === TASK_DRAG_KIND.task
}
