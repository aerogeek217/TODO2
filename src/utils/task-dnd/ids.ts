/**
 * Centralized id factories for every surface that renders a draggable task
 * row. Phase 1 of the DnD unification plan emits the same id strings that the
 * per-surface wrappers emit today — this module exists so later phases can
 * change the format in one place.
 *
 * Surfaces:
 *
 * | surface key       | emitted id              | notes                          |
 * |-------------------|-------------------------|--------------------------------|
 * | canvas-project    | `todo-<id>`             | sortable in project body       |
 * | inset             | `inset-todo-<id>`       | ListInsetNode floating widget  |
 * | lens              | `lens-todo-<id>`        | rail lens slot row             |
 * | list              | `list-todo-<id>`        | ListView row                   |
 * | calendar-view     | `calview-todo-<id>`     | CalendarView row; drops via dispatchTaskDrop → reschedule |
 * | calendar-strip    | `calstrip-todo-<id>`    | rail/float CalendarStrip row; drops via dispatchTaskDrop → reschedule |
 * | list-widget       | `lw|<tab>|<section>|<id>` | workspace list widget row — one id per occurrence (a task with two people shows in both people's groups) |
 */

export type TaskSurfaceKey =
  | 'canvas-project'
  | 'lens'
  | 'inset'
  | 'list'
  | 'calendar-view'
  | 'calendar-strip'
  | 'list-widget'

/**
 * Extras required by some surfaces:
 *  - `list-widget` needs `scope` (the widget's tab id) and `sectionKey` (the
 *    group the row shows in): a task can show in several groups of one
 *    widget, and the same list in several widgets.
 */
export interface TaskDragIdExtras {
  scope?: string
  sectionKey?: string
}

/**
 * Emit the draggable/sortable id for a given surface + todo id.
 *
 * `extras` are required for `list-widget` (`scope`, `sectionKey`); omitted for
 * all other surfaces.
 */
export function taskDragId(
  surface: TaskSurfaceKey,
  todoId: number,
  extras?: TaskDragIdExtras,
): string {
  switch (surface) {
    case 'canvas-project':
      return `todo-${todoId}`
    case 'inset':
      return `inset-todo-${todoId}`
    case 'lens':
      return `lens-todo-${todoId}`
    case 'list':
      return `list-todo-${todoId}`
    case 'calendar-view':
      return `calview-todo-${todoId}`
    case 'calendar-strip':
      return `calstrip-todo-${todoId}`
    case 'list-widget':
      if (extras?.scope == null || extras.sectionKey == null) {
        throw new Error('taskDragId("list-widget") requires extras.scope and extras.sectionKey')
      }
      return `lw|${extras.scope}|${extras.sectionKey}|${todoId}`
  }
}

/** Known task-drag id prefixes used by dnd-kit surfaces today. */
const TASK_DRAG_PREFIXES: readonly string[] = [
  'todo-',
  'inset-todo-',
  'lens-todo-',
  'list-todo-',
  'calview-todo-',
  'calstrip-todo-',
  'lw|',
]

/**
 * Cheap check: is this id any known task-drag id? Conservative — returns true
 * for any string starting with one of the known prefixes. Callers that need to
 * distinguish surfaces should decode further.
 *
 * Drop-target ids (`project-drop-…`, `calday-…`) are NOT task-drag ids.
 */
export function isTaskDragId(id: string | number | null | undefined): boolean {
  if (typeof id !== 'string') return false
  for (const p of TASK_DRAG_PREFIXES) if (id.startsWith(p)) return true
  return false
}

// ── Drop-target ids (task drop zones) ──────────────────────────────────────
//
// Drop zones for task payloads live here too so all dnd id vocabulary is in
// one place. The canvas / calendar drop handlers match on these ids.

export function projectDropId(projectId: number): string {
  return `project-drop-${projectId}`
}

/**
 * Drop-zone id for a calendar day cell. Emitted by CalendarStrip (rail +
 * float + view) and CalendarView day grids. `scope` distinguishes multiple
 * calendar surfaces sharing a `DndContext` (e.g. two rail-docked strips +
 * a floating calendar on the same canvas) so their day cells register
 * distinct droppable ids.
 */
export function calendarDayDropId(scope: string, dateMs: number): string {
  return `calday-${scope}-${dateMs}`
}

/**
 * Stable scope for `CalendarView`'s month/week grid day cells. Lives here so
 * all drag-id construction is colocated rather than per-surface.
 */
export const CALENDAR_VIEW_SCOPE = 'calview'
