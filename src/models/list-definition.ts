import type { ListSortBy } from './app-view'
import type { TodoPredicate } from './filter-predicate'

/**
 * Serializable predicate DSL for list membership. Grown in v22 with
 * per-list `warningWindowDays` (today bucket) and `custom` (user-defined
 * predicate, see `TodoPredicate`).
 */
export type ListMembership =
  | {
      kind: 'today'
      /**
       * Days ahead of "today" to pull deadlines into the bucket. Defaults to 3
       * when omitted (preserves pre-v22 hardcoded `WARNING_WINDOW_DAYS`).
       */
      warningWindowDays?: number
    }
  | { kind: 'upcoming'; warningWindowDays?: number }
  | { kind: 'deadlines' }
  | { kind: 'someday' }
  | { kind: 'custom'; predicate: TodoPredicate }

export type ListSort =
  | { kind: 'effective-date-asc' }
  | { kind: 'deadline-asc' }
  | { kind: 'sort-order' }
  | { kind: 'sortBy'; by: ListSortBy }

export type ListGrouping =
  | { kind: 'none' }
  | { kind: 'relative-effective' }
  | { kind: 'relative-deadline' }
  | { kind: 'by-sortBy' }

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
