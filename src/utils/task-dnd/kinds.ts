/**
 * Canonical `data.type` strings for task-shaped drag payloads. Every surface
 * that drags a plain task row emits `'task'`; the drag id (see `ids.ts`) and
 * any extras in `data` distinguish where the drag came from.
 */
export const TASK_DRAG_KIND = {
  /** Any draggable task row — list widget row (also glance widget rows), calendar entry. */
  task: 'task',
} as const

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
  /** A Planner's day tile. The drop data is a `PlannerDropData` (`dispatch.ts`):
   * the Planner (`scope`), the day and its window, so the dispatcher can ask
   * for the write without consulting the DOM. */
  plannerDay: 'planner-day',
  /** A Planner's group (Today, a day ahead, Focus no day): a `PlannerDropData`
   * with the `group` too — its rows and every row shown, for the hand order. */
  plannerGroup: 'planner-group',
} as const

export type TaskDropKind = typeof TASK_DROP_KIND[keyof typeof TASK_DROP_KIND]
