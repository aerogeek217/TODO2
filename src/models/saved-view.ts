import type { ListSortBy, DateField } from './app-view'

/** Serializable snapshot of filter + grouping state */
export interface SavedViewFilters {
  priorities: number[] | null  // Priority enum values; null = no filter
  showCompleted: boolean
  showHiddenStatuses: boolean
  /** @deprecated v1 legacy — kept for reading old saved views */
  completedFilter?: string
  /** @deprecated v1 legacy — kept for reading old saved views */
  assignedFilter?: string
  /** @deprecated v1 legacy — kept for reading old saved views */
  followupFilter?: string
  /** @deprecated v1 legacy — kept for reading old saved views */
  showAssigned?: boolean
  /** @deprecated v1 legacy — kept for reading old saved views */
  starredOnly?: boolean
  hardDeadlineOnly: boolean
  personIds: number[] | null
  personFilterMode?: 'include-orgs' | 'direct-only'
  tagIds: number[] | null
  orgIds: number[] | null
  orgFilterMode?: 'include-people' | 'direct-only'
  statusIds?: number[] | null
  /** Which date field to filter on (optional for backward compat; defaults to 'due') */
  dateField?: DateField
  /** ISO string of date range start (optional for backward compat) */
  dateRangeStart?: string | null
  /** ISO string of date range end (optional for backward compat) */
  dateRangeEnd?: string | null
  dateRangeIncludeNoDue: boolean
}

export interface SavedView {
  id?: number
  name: string
  sortBy: ListSortBy
  filters: SavedViewFilters
  sortOrder: number
}

export type PersistedSavedView = SavedView & { id: number }
