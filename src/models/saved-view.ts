import type { ListSortBy, DateField } from './app-view'

/** Serializable snapshot of filter + grouping state */
export interface SavedViewFilters {
  priorities: number[] | null  // Priority enum values; null = no filter
  showCompleted: boolean
  showAssigned: boolean
  starredOnly: boolean
  hardDeadlineOnly: boolean
  personIds: number[] | null
  tagIds: number[] | null
  orgIds: number[] | null
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
