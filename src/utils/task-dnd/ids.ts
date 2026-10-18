/**
 * Centralized id factories for every surface that renders a draggable task
 * row, so the id format lives in one place.
 *
 * Surfaces:
 *
 * | surface key       | emitted id              | notes                          |
 * |-------------------|-------------------------|--------------------------------|
 * | list-widget       | `lw|<tab>|<section>|<id>` | workspace list widget row — one id per occurrence (a task with two people shows in both people's groups); Eisenhower quadrant and Dashboard section rows use it too |
 * | calendar-widget   | `cw|<tab>|<slot>|<id>`  | workspace calendar entry — `slot` = the entry's date type (`due` / `followup`), prefixed `pop-` inside the day popover; drops via dispatchTaskDrop → reschedule |
 */

export type TaskSurfaceKey =
  | 'list-widget'
  | 'calendar-widget'

/**
 * Extras required by some surfaces:
 *  - `list-widget` needs `scope` (the widget's tab id) and `sectionKey` (the
 *    group the row shows in): a task can show in several groups of one
 *    widget, and the same list in several widgets.
 *  - `calendar-widget` needs `scope` (the widget's tab id) and `sectionKey`
 *    (the entry's slot): a task shows once per date type, and again in an
 *    open day popover.
 */
export interface TaskDragIdExtras {
  scope?: string
  sectionKey?: string
}

/**
 * Emit the draggable id for a given surface + todo id.
 *
 * `extras` (`scope`, `sectionKey`) are required.
 */
export function taskDragId(
  surface: TaskSurfaceKey,
  todoId: number,
  extras?: TaskDragIdExtras,
): string {
  switch (surface) {
    case 'list-widget':
      if (extras?.scope == null || extras.sectionKey == null) {
        throw new Error('taskDragId("list-widget") requires extras.scope and extras.sectionKey')
      }
      return `lw|${extras.scope}|${extras.sectionKey}|${todoId}`
    case 'calendar-widget':
      if (extras?.scope == null || extras.sectionKey == null) {
        throw new Error('taskDragId("calendar-widget") requires extras.scope and extras.sectionKey')
      }
      return `cw|${extras.scope}|${extras.sectionKey}|${todoId}`
  }
}

// ── Drop-target ids (task drop zones) ──────────────────────────────────────

/**
 * Drop-zone id for a calendar day cell. `scope` distinguishes several
 * calendars sharing one `DndContext` (two calendar widgets, or a widget and
 * its day popover) so their day cells register distinct droppable ids.
 */
export function calendarDayDropId(scope: string, dateMs: number): string {
  return `calday-${scope}-${dateMs}`
}

/** Drop-zone id for one quadrant of an Eisenhower widget (`scope` = its tab id). */
export function eisenhowerQuadrantDropId(scope: string, quadrant: string): string {
  return `eis-${scope}-${quadrant}`
}
