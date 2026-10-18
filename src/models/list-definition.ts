import type { TodoPredicate } from './filter-predicate'
import type { TodoSortBy, TodoGroupBy, TodoSortDirection } from './todo-sort-group'

/**
 * Serializable predicate DSL for list membership. Post-v24, the only kind is
 * `custom` — the former `today` / `upcoming` / `deadlines` / `someday` kinds
 * were retired in favor of custom predicates authored via `TodoPredicate`. The `kind` discriminator is kept
 * for forward-compat (future kinds like `saved-search` remain cheap to add).
 */
export type ListMembership =
  | { kind: 'custom'; predicate: TodoPredicate }

/**
 * Persisted sort field: a flat
 * `TodoSortBy` literal — the former discriminated union (`{kind:'sort-order'}`
 * / `{kind:'sortBy', by}` / etc.) was flattened in the v46 Dexie migration.
 */
export type ListSort = TodoSortBy

/**
 * Persisted grouping field: a flat
 * `TodoGroupBy` literal — the former discriminated union (`{kind:'none'}` /
 * `{kind:'by-field', by}` / `{kind:'by-tag'}` / etc.) was flattened in the
 * v46 Dexie migration. The former `{kind:'by-sortBy'}` "match the sort"
 * semantic is gone; surfaces that want sort+group coupled set them to the
 * same value explicitly.
 */
export type ListGrouping = TodoGroupBy

/** Which entity a saved list's runtime-filter picker narrows on. */
export type RuntimeFilterField = 'person' | 'status' | 'tag'

/**
 * Optional prompt: the list asks for one or more values of `field` at render
 * time, merged into the predicate as an OR on that field (e.g. "Tasks for
 * {assignee}"). Only the field is part of the definition; the picks are
 * temporary and belong to the surface showing the list.
 */
export interface RuntimeFilterSpec {
  field: RuntimeFilterField
  /** Optional override for the picker label; defaults to the capitalised field. */
  label?: string
}

export interface ListDefinition {
  id?: number
  name: string
  sortOrder: number
  membership: ListMembership
  sort: ListSort
  /**
   * `desc` reverses the sort (see `TodoSortDirection`). Absent or `asc` =
   * the sort's natural order; ignored for a sort without a direction
   * (Manual — `sortHasDirection`).
   */
  sortDirection?: TodoSortDirection
  grouping: ListGrouping
  /** When set, the list exposes a picker at render time; see `RuntimeFilterSpec`. */
  runtimeFilter?: RuntimeFilterSpec
}

export type PersistedListDefinition = ListDefinition & { id: number }
