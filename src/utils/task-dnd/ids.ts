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
 * | dashboard         | `dashboard-<listKey>-<id>` | dashboard card row (needs listKey) |
 * | taskboard-panel   | `tbp-<id>`              | singleton taskboard entry      |
 * | taskboard-float   | `tb-<floatingId>-<id>`  | floating canvas taskboard entry |
 * | calendar-view     | `calview-todo-<id>`     | native HTML5 today; reserved for Phase 7 |
 * | calendar-strip    | `calstrip-todo-<id>`    | native HTML5 today; reserved for Phase 7 |
 * | search            | `search-todo-<id>`      | TopBar search-result row (P3)  |
 */

export type TaskSurfaceKey =
  | 'canvas-project'
  | 'lens'
  | 'inset'
  | 'taskboard-panel'
  | 'taskboard-float'
  | 'list'
  | 'dashboard'
  | 'calendar-view'
  | 'calendar-strip'
  | 'search'

/**
 * Extras required by some surfaces:
 *  - `dashboard` needs `listKey` (one dashboard grid can show the same todo in
 *    several list cards).
 *  - `taskboard-float` needs `floatingId` (one canvas can host multiple
 *    floating taskboard widgets that all view the singleton board).
 */
export interface TaskDragIdExtras {
  listKey?: string
  floatingId?: number
}

/**
 * Emit the draggable/sortable id for a given surface + todo id.
 *
 * `extras` are required for `dashboard` (`listKey`) and `taskboard-float`
 * (`floatingId`); omitted for all other surfaces.
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
    case 'dashboard':
      if (extras?.listKey == null) {
        throw new Error('taskDragId("dashboard") requires extras.listKey')
      }
      return `dashboard-${extras.listKey}-${todoId}`
    case 'taskboard-panel':
      return `tbp-${todoId}`
    case 'taskboard-float':
      if (extras?.floatingId == null) {
        throw new Error('taskDragId("taskboard-float") requires extras.floatingId')
      }
      return `tb-${extras.floatingId}-${todoId}`
    case 'calendar-view':
      return `calview-todo-${todoId}`
    case 'calendar-strip':
      return `calstrip-todo-${todoId}`
    case 'search':
      return `search-todo-${todoId}`
  }
}

/** Known task-drag id prefixes used by dnd-kit surfaces today. */
const TASK_DRAG_PREFIXES: readonly string[] = [
  'todo-',
  'inset-todo-',
  'lens-todo-',
  'list-todo-',
  'dashboard-',
  'tbp-',
  'tb-',
  'calview-todo-',
  'calstrip-todo-',
  'search-todo-',
]

/**
 * Cheap check: is this id any known task-drag id? Conservative — returns true
 * for any string starting with one of the known prefixes. Callers that need to
 * distinguish surfaces should decode further.
 *
 * Drop-target ids (`project-drop-…`, `dashboard-taskboard-drop`,
 * `taskboard-drop-<id>`) are NOT task-drag ids; see
 * {@link isTaskDragId}.
 */
export function isTaskDragId(id: string | number | null | undefined): boolean {
  if (typeof id !== 'string') return false
  for (const p of TASK_DRAG_PREFIXES) if (id.startsWith(p)) return true
  return false
}

/**
 * Parse a taskboard entry id (`tbp-<todoId>` or `tb-<floatingId>-<todoId>`)
 * into its numeric components. Returns `null` if the id is neither shape.
 *
 * Replaces the fragile `Number(id.split('-').pop())` sniff that canvas and
 * dashboard drop handlers use today (F9 in dnd-audit.md). That sniff happens
 * to produce the right number for both shapes only because the last hyphen-
 * separated segment is always the todoId — if anyone adds a future
 * third-surface taskboard id with its own trailing discriminator, the old
 * parse silently reads the wrong number.
 */
export function parseTaskboardEntryId(
  id: string,
): { todoId: number; floatingId?: number } | null {
  // Singleton panel: `tbp-<todoId>`
  if (id.startsWith('tbp-')) {
    const todoId = Number(id.slice('tbp-'.length))
    if (Number.isFinite(todoId)) return { todoId }
    return null
  }
  // Floating node: `tb-<floatingId>-<todoId>`
  if (id.startsWith('tb-')) {
    const body = id.slice('tb-'.length)
    const dash = body.indexOf('-')
    if (dash <= 0) return null
    const floatingId = Number(body.slice(0, dash))
    const todoId = Number(body.slice(dash + 1))
    if (Number.isFinite(floatingId) && Number.isFinite(todoId)) {
      return { todoId, floatingId }
    }
    return null
  }
  return null
}

// ── Drop-target ids (task drop zones) ──────────────────────────────────────
//
// Drop zones for task payloads live here too so all dnd id vocabulary is in
// one place. The canvas/dashboard/listview drop handlers match on these ids.

export const TASKBOARD_SINGLETON_DROP_ID = 'dashboard-taskboard-drop'

export function projectDropId(projectId: number): string {
  return `project-drop-${projectId}`
}

export function taskboardFloatDropId(floatingId: number): string {
  return `taskboard-drop-${floatingId}`
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
