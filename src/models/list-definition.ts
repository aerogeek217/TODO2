import type { TodoPredicate } from './filter-predicate'
import type { TodoSortBy, TodoGroupBy } from './todo-sort-group'

/**
 * Serializable predicate DSL for list membership. Post-v24, the only kind is
 * `custom` — the former `today` / `upcoming` / `deadlines` / `someday` kinds
 * were retired when the 5 horizon seeds landed (each horizon is now a custom
 * predicate authored via `TodoPredicate`). The `kind` discriminator is kept
 * for forward-compat (future kinds like `saved-search` remain cheap to add).
 */
export type ListMembership =
  | { kind: 'custom'; predicate: TodoPredicate }

/**
 * Persisted sort field. Post ui-consistency-2026-04-25 P4 this is a flat
 * `TodoSortBy` literal — the former discriminated union (`{kind:'sort-order'}`
 * / `{kind:'sortBy', by}` / etc.) was flattened in the v46 Dexie migration.
 */
export type ListSort = TodoSortBy

/**
 * Persisted grouping field. Post ui-consistency-2026-04-25 P4 this is a flat
 * `TodoGroupBy` literal — the former discriminated union (`{kind:'none'}` /
 * `{kind:'by-field', by}` / `{kind:'by-tag'}` / etc.) was flattened in the
 * v46 Dexie migration. The former `{kind:'by-sortBy'}` "match the sort"
 * semantic is gone; surfaces that want sort+group coupled set them to the
 * same value explicitly.
 */
export type ListGrouping = TodoGroupBy

/** Which entity a saved list's runtime-filter picker narrows on. */
export type RuntimeFilterField = 'person' | 'org' | 'project' | 'status' | 'tag'

/**
 * Optional per-card prompt: the consumer supplies one id at render time that
 * is merged into the definition's predicate as an equality on the chosen
 * field (e.g. "Tasks for {assignee}"). Not persisted — each surface keeps its
 * own current pick.
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
  grouping: ListGrouping
  /** When true, the list appears as a Dashboard card. Default true on migration from pre-v22. */
  pinnedToDashboard: boolean
  /**
   * When true, the list shows up in ListView's favorites chip bar. Separate
   * from `pinnedToDashboard` so the two discoverability surfaces can be
   * toggled independently. Defaults to false.
   */
  favorited: boolean
  /** Optional cap on the number of visible tasks. Undefined = unlimited. */
  maxTasks?: number
  /** How `maxTasks` is enforced. Defaults to `'hard'` when omitted. */
  limitMode?: 'hard' | 'scroll'
  /** When set, the list exposes a picker at render time; see `RuntimeFilterSpec`. */
  runtimeFilter?: RuntimeFilterSpec
}

export type PersistedListDefinition = ListDefinition & { id: number }
