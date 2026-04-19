import type { ListSortBy } from './app-view'
import type { TodoPredicate } from './filter-predicate'

/**
 * Serializable predicate DSL for list membership. Post-v24, the only kind is
 * `custom` — the former `today` / `upcoming` / `deadlines` / `someday` kinds
 * were retired when the 5 horizon seeds landed (each horizon is now a custom
 * predicate authored via `TodoPredicate`). The `kind` discriminator is kept
 * for forward-compat (future kinds like `saved-search` remain cheap to add).
 */
export type ListMembership =
  | { kind: 'custom'; predicate: TodoPredicate }

export type ListSort =
  | { kind: 'effective-date-asc' }
  | { kind: 'scheduled-asc' }
  | { kind: 'deadline-asc' }
  | { kind: 'sort-order' }
  | { kind: 'sortBy'; by: ListSortBy }

export type ListGrouping =
  | { kind: 'none' }
  | { kind: 'relative-effective' }
  | { kind: 'relative-deadline' }
  | { kind: 'by-sortBy' }
  /** Group by a specific field, independent of sort. Chronological fields bucket
   *  by relative windows; categorical fields fall back to flat in the interpreter
   *  (ListView handles categorical bucketing locally). */
  | { kind: 'by-field'; by: ListSortBy }

export interface ListDefinition {
  id?: number
  name: string
  sortOrder: number
  membership: ListMembership
  sort: ListSort
  grouping: ListGrouping
  /** When true, the list appears as a Dashboard card. Default true on migration from pre-v22. */
  pinnedToDashboard: boolean
}

export type PersistedListDefinition = ListDefinition & { id: number }
