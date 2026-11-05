/**
 * Unified sort + group dimensions for every list surface (list widgets, the
 * list definitions they show). Stored on `ListDefinition.sort` /
 * `.grouping` as flat literals.
 *
 * Each surface declares its supported subset as a `readonly TodoSortBy[]` /
 * `readonly TodoGroupBy[]` array (see the constants below). Adding a new
 * sort/group option is a one-line union widen + per-surface opt-in.
 */

export type TodoSortBy =
  | 'manual'      // per-list manual order (ranks), else sortOrder
  | 'priority'    // Focus, Urgent + Important, Urgent, Important, none; then due date
  | 'name'        // alphabetical title
  | 'deadline'    // dueDate (UI label "Due")
  | 'followup'    // nextFollowupAt (UI label "Next follow-up")
  | 'lastFollowup' // lastFollowupAt (oldest first: the longest unchased on top)
  | 'completed'   // completedAt (picked newest first: `SORT_DIRECTION_ON_PICK`)
  | 'created'     // createdAt
  | 'modified'    // modifiedAt (oldest first: the untouched tasks on top)
  | 'people'      // the first assigned person's name, unassigned last
  | 'status'      // the statuses' order in Settings, no status last

export type TodoGroupBy =
  | 'none'        // flat list — no group headers
  | 'deadline'    // relative buckets on dueDate (Overdue / Today / This week / …)
  | 'followup'    // relative buckets on nextFollowupAt
  | 'people'      // many-to-many
  | 'status'
  | 'tag'         // many-to-many
  | 'priority'    // many-to-many: Focus, Urgent, Important, No priority

export const TODO_SORT_BY_VALUES: readonly TodoSortBy[] = [
  'manual', 'priority', 'name', 'deadline', 'followup', 'lastFollowup', 'completed', 'created', 'modified',
  'people', 'status',
] as const

export const TODO_GROUP_BY_VALUES: readonly TodoGroupBy[] = [
  'none', 'deadline', 'followup',
  'people', 'status', 'tag', 'priority',
] as const

export function isTodoSortBy(v: unknown): v is TodoSortBy {
  return typeof v === 'string' && (TODO_SORT_BY_VALUES as readonly string[]).includes(v)
}

export function isTodoGroupBy(v: unknown): v is TodoGroupBy {
  return typeof v === 'string' && (TODO_GROUP_BY_VALUES as readonly string[]).includes(v)
}

/**
 * Which way a sort runs. `asc` is each sort's natural order (soonest /
 * oldest / A → Z / highest priority first); `desc` reverses its primary key
 * only — ties keep their tie-break order, and tasks without a date stay last.
 */
export type TodoSortDirection = 'asc' | 'desc'

export const TODO_SORT_DIRECTIONS: readonly TodoSortDirection[] = ['asc', 'desc'] as const

export function isTodoSortDirection(v: unknown): v is TodoSortDirection {
  return typeof v === 'string' && (TODO_SORT_DIRECTIONS as readonly string[]).includes(v)
}

/**
 * Whether a sort has a direction. Manual (the user's drag order) and the
 * sorts with no ordering of their own (People / Status fall back to manual
 * order) have none.
 */
export function sortHasDirection(sortBy: TodoSortBy): boolean {
  return sortBy !== 'manual' && sortBy !== 'people' && sortBy !== 'status' && isTodoSortBy(sortBy)
}

/**
 * The direction a sort starts in when picked, for the sorts that have one of
 * their own: Completed newest first, Last followed up oldest first (D22).
 * Any other sort keeps the direction it is picked with (`Due ↓` → `Name ↓`).
 */
export const SORT_DIRECTION_ON_PICK: Partial<Record<TodoSortBy, TodoSortDirection>> = {
  lastFollowup: 'asc',
  completed: 'desc',
}

/** The direction `sortBy` runs in once picked while `current` was set: its own (`SORT_DIRECTION_ON_PICK`), else `current`. */
export function sortDirectionOnPick(sortBy: TodoSortBy, current: TodoSortDirection): TodoSortDirection {
  return SORT_DIRECTION_ON_PICK[sortBy] ?? current
}

/** The direction a sort runs in: `desc` only when asked for and the sort has a direction. */
export function effectiveSortDirection(sortBy: TodoSortBy, direction: TodoSortDirection | undefined): TodoSortDirection {
  return direction === 'desc' && sortHasDirection(sortBy) ? 'desc' : 'asc'
}
