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
  'manual', 'name', 'deadline', 'followup', 'created',
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

/** Per-surface supported subsets — single source of truth for option arrays. */
export const LIST_SORT_VALUES: readonly TodoSortBy[] =
  ['manual', 'name', 'deadline', 'followup'] as const

export const LIST_GROUP_VALUES: readonly TodoGroupBy[] =
  ['none', 'deadline', 'followup', 'status', 'people', 'tag'] as const
