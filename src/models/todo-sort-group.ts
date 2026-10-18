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
  | 'followup'    // nextFollowupAt
  | 'created'     // createdAt
  | 'people'      // sortOrder fallback (categorical)
  | 'status'      // sortOrder fallback

export type TodoGroupBy =
  | 'none'        // flat list — no group headers
  | 'deadline'    // relative buckets on dueDate (Overdue / Today / This week / …)
  | 'followup'    // relative buckets on nextFollowupAt
  | 'people'      // many-to-many
  | 'status'
  | 'tag'         // many-to-many

export const TODO_SORT_BY_VALUES: readonly TodoSortBy[] = [
  'manual', 'priority', 'name', 'deadline', 'followup', 'created',
  'people', 'status',
] as const

export const TODO_GROUP_BY_VALUES: readonly TodoGroupBy[] = [
  'none', 'deadline', 'followup',
  'people', 'status', 'tag',
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

/** The direction a sort runs in: `desc` only when asked for and the sort has a direction. */
export function effectiveSortDirection(sortBy: TodoSortBy, direction: TodoSortDirection | undefined): TodoSortDirection {
  return direction === 'desc' && sortHasDirection(sortBy) ? 'desc' : 'asc'
}
