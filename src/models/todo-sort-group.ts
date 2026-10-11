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
  | 'deadline'    // dueDate (UI label "Due")
  | 'followup'    // nextFollowupAt
  | 'created'     // createdAt
  | 'people'      // sortOrder fallback (categorical)
  | 'project'     // sortOrder fallback
  | 'status'      // sortOrder fallback

export type TodoGroupBy =
  | 'none'        // flat list — no group headers
  | 'deadline'    // relative buckets on dueDate (Overdue / Today / This week / …)
  | 'followup'    // relative buckets on nextFollowupAt
  | 'people'      // many-to-many
  | 'project'
  | 'status'
  | 'tag'         // many-to-many

export const TODO_SORT_BY_VALUES: readonly TodoSortBy[] = [
  'manual', 'name', 'deadline', 'followup', 'created',
  'people', 'project', 'status',
] as const

export const TODO_GROUP_BY_VALUES: readonly TodoGroupBy[] = [
  'none', 'deadline', 'followup',
  'people', 'project', 'status', 'tag',
] as const

export function isTodoSortBy(v: unknown): v is TodoSortBy {
  return typeof v === 'string' && (TODO_SORT_BY_VALUES as readonly string[]).includes(v)
}

export function isTodoGroupBy(v: unknown): v is TodoGroupBy {
  return typeof v === 'string' && (TODO_GROUP_BY_VALUES as readonly string[]).includes(v)
}

/** Per-surface supported subsets — single source of truth for option arrays. */
export const PROJECT_SORT_VALUES: readonly TodoSortBy[] =
  ['manual', 'name', 'deadline', 'created'] as const

export const PROJECT_GROUP_VALUES: readonly TodoGroupBy[] =
  ['none', 'deadline', 'followup', 'status', 'people', 'tag'] as const

export const LIST_SORT_VALUES: readonly TodoSortBy[] =
  ['manual', 'name', 'deadline', 'followup'] as const

export const LIST_GROUP_VALUES: readonly TodoGroupBy[] =
  ['none', 'deadline', 'followup', 'project', 'status', 'people', 'tag'] as const

/** Full set for the per-list editor (it's the most permissive surface). */
export const LIST_EDITOR_SORT_VALUES: readonly TodoSortBy[] =
  ['manual', 'deadline', 'followup', 'project', 'status', 'people'] as const

export const LIST_EDITOR_GROUP_VALUES: readonly TodoGroupBy[] =
  ['none', 'deadline', 'followup', 'project', 'status', 'people', 'tag'] as const
