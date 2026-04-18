import type { ListSortBy, ListGroupBy, ListItemSortBy } from './app-view'
import type { TodoPredicate } from './filter-predicate'

/**
 * Serializable snapshot of filter + grouping state. Composes `TodoPredicate`
 * for the live fields; keeps `@deprecated` legacy fields only (they are read
 * by `savedFiltersToRuntime` but never written).
 *
 * Fields from `TodoPredicate` are made optional here because pre-v21 saved
 * views may omit them; `savedFiltersToRuntime` fills in defaults.
 */
export interface SavedViewFilters extends Partial<TodoPredicate> {
  /** @deprecated v20→v21 legacy — kept for reading old saved views; ignored at runtime */
  priorities?: number[] | null
  /** @deprecated v19→v20 legacy — kept for reading old saved views */
  completedFilter?: string
  /** @deprecated v19→v20 legacy — kept for reading old saved views */
  assignedFilter?: string
  /** @deprecated v19→v20 legacy — kept for reading old saved views */
  followupFilter?: string
  /** @deprecated v19→v20 legacy — kept for reading old saved views */
  showAssigned?: boolean
  /** @deprecated v19→v20 legacy — kept for reading old saved views */
  starredOnly?: boolean
  /** @deprecated v20→v21 legacy — kept for reading old saved views; ignored at runtime */
  hardDeadlineOnly?: boolean
  /** @deprecated v20→v21 legacy — renamed to dateRangeIncludeNoDate */
  dateRangeIncludeNoDue?: boolean
}

export interface SavedView {
  id?: number
  name: string
  /**
   * Legacy field (pre split-group-and-sort). Still written on save as
   * `groupBy` narrowed to a ListSortBy value (defaults to `'date'` when
   * groupBy is `'none'`), so pre-split code can still read the view.
   */
  sortBy: ListSortBy
  /** Preferred read source (post split). What to group by; `'none'` = flat. */
  groupBy?: ListGroupBy
  /** Sort applied within each group (or the whole list when groupBy='none'). */
  itemSortBy?: ListItemSortBy
  filters: SavedViewFilters
  sortOrder: number
  /**
   * Optional cap on the number of visible tasks. Undefined = unlimited.
   * When `limitMode` is `'hard'` the remaining tasks are hidden; when `'scroll'`
   * they're kept rendered inside a bounded scrollable container.
   */
  maxTasks?: number
  /** How `maxTasks` is enforced. Defaults to `'hard'` when omitted. */
  limitMode?: 'hard' | 'scroll'
}

export type PersistedSavedView = SavedView & { id: number }
