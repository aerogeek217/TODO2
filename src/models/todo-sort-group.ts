/**
 * Unified sort + group dimensions for every todo-list surface (canvas
 * `ProjectNode`, `/list`, list-definitions on the dashboard / rails / floats).
 * Replaces the per-surface enums (`ListSortBy` / `ListItemSortBy` /
 * `ListGroupBy` / `ProjectGroupBy`) and the on-disk discriminated-union
 * shapes for `ListDefinition.sort` / `.grouping`.
 *
 * Each surface declares its supported subset as a `readonly TodoSortBy[]` /
 * `readonly TodoGroupBy[]` array (see the constants below). Adding a new
 * sort/group option is a one-line union widen + per-surface opt-in.
 */

export type TodoSortBy =
  | 'manual'      // sortOrder — preserves the current visual order
  | 'name'        // alphabetical title
  | 'date'        // effective date (scheduled fallback to deadline)
  | 'scheduled'   // scheduled date
  | 'deadline'    // dueDate
  | 'created'     // createdAt
  | 'people'      // sortOrder fallback (categorical)
  | 'project'     // sortOrder fallback
  | 'org'         // sortOrder fallback
  | 'status'      // sortOrder fallback

export type TodoGroupBy =
  | 'none'        // flat list — no group headers
  | 'date'        // relative date buckets on effective date (Today / This week / …)
  | 'scheduled'   // relative buckets on scheduled date
  | 'deadline'    // relative buckets on dueDate
  | 'people'      // many-to-many
  | 'project'
  | 'org'         // direct + person→org membership
  | 'status'
  | 'tag'         // many-to-many

export const TODO_SORT_BY_VALUES: readonly TodoSortBy[] = [
  'manual', 'name', 'date', 'scheduled', 'deadline', 'created',
  'people', 'project', 'org', 'status',
] as const

export const TODO_GROUP_BY_VALUES: readonly TodoGroupBy[] = [
  'none', 'date', 'scheduled', 'deadline',
  'people', 'project', 'org', 'status', 'tag',
] as const

export function isTodoSortBy(v: unknown): v is TodoSortBy {
  return typeof v === 'string' && (TODO_SORT_BY_VALUES as readonly string[]).includes(v)
}

export function isTodoGroupBy(v: unknown): v is TodoGroupBy {
  return typeof v === 'string' && (TODO_GROUP_BY_VALUES as readonly string[]).includes(v)
}

/** Per-surface supported subsets — single source of truth for option arrays. */
export const PROJECT_SORT_VALUES: readonly TodoSortBy[] =
  ['manual', 'name', 'date', 'created'] as const

export const PROJECT_GROUP_VALUES: readonly TodoGroupBy[] =
  ['none', 'date', 'scheduled', 'deadline', 'status', 'people', 'org', 'tag'] as const

export const LIST_SORT_VALUES: readonly TodoSortBy[] =
  ['manual', 'name', 'date', 'scheduled', 'deadline'] as const

export const LIST_GROUP_VALUES: readonly TodoGroupBy[] =
  ['none', 'date', 'scheduled', 'deadline', 'project', 'status', 'people', 'org', 'tag'] as const

/** Full set for the per-list editor (it's the most permissive surface). */
export const LIST_EDITOR_SORT_VALUES: readonly TodoSortBy[] =
  ['manual', 'date', 'scheduled', 'deadline', 'project', 'status', 'people', 'org'] as const

export const LIST_EDITOR_GROUP_VALUES: readonly TodoGroupBy[] =
  ['none', 'date', 'scheduled', 'deadline', 'project', 'status', 'people', 'org', 'tag'] as const
