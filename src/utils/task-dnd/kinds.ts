/**
 * Canonical `data.type` strings for task-shaped drag payloads.
 *
 * There are four kinds today. Phase 4 of the DnD unification plan will reduce
 * the three "this is a task from surface X" aliases (`task`, `list-task`,
 * `dashboard-task`) to a single `'task'` with a separate `surface` field in
 * the payload; `'taskboard-task'` stays distinct because its drop-off-target
 * behavior (remove from board) differs from a plain task.
 *
 * Until that consolidation lands, emit these constants instead of literal
 * strings so one file owns the vocabulary.
 */
export const TASK_DRAG_KIND = {
  /** Canvas project rows, inset, lens, and any future "generic task" source. */
  task: 'task',
  /** Taskboard entry (singleton panel or floating node) — drop-off removes. */
  taskboardTask: 'taskboard-task',
  /** Dashboard task row — current behavior matches `task` but routes via the dashboard DndContext. */
  dashboardTask: 'dashboard-task',
  /** ListView task row — section-reassignment intent, not reorder. */
  listTask: 'list-task',
} as const

export type TaskDragKind = typeof TASK_DRAG_KIND[keyof typeof TASK_DRAG_KIND]

/**
 * Canonical `data.type` strings for drop targets that accept task drags. These
 * are what live on `useDroppable`'s `data` field and what drop handlers read
 * via `event.over.data.current.type`.
 *
 * Note the overlap with `TASK_DRAG_KIND.task`: the canvas project's sortable
 * task rows register with `type: 'task'`, acting simultaneously as a drag
 * source and as a drop target for reordering. That dual-role is preserved —
 * this constant exists so drop-side comparisons have a named home.
 */
export const TASK_DROP_KIND = {
  /** Sortable task row (SortableTaskList entries). */
  task: 'task',
  /** Project container (ProjectNode body). */
  project: 'project',
  /** Taskboard panel/node container. */
  taskboard: 'taskboard',
  /** Taskboard sortable entry — matches `TASK_DRAG_KIND.taskboardTask`. */
  taskboardTask: 'taskboard-task',
} as const

export type TaskDropKind = typeof TASK_DROP_KIND[keyof typeof TASK_DROP_KIND]

/** True when a `data.type` value marks a task-shaped drag payload. */
export function isTaskDragKind(v: unknown): v is TaskDragKind {
  return (
    v === TASK_DRAG_KIND.task
    || v === TASK_DRAG_KIND.taskboardTask
    || v === TASK_DRAG_KIND.dashboardTask
    || v === TASK_DRAG_KIND.listTask
  )
}
