import type { ListSortBy, DateField } from './app-view'

/** Serializable snapshot of filter + grouping state */
export interface SavedViewFilters {
  /** @deprecated v20→v21 legacy — kept for reading old saved views; ignored at runtime */
  priorities?: number[] | null
  showCompleted: boolean
  showHiddenStatuses: boolean
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
  personIds: number[] | null
  personFilterMode?: 'include-orgs' | 'direct-only'
  tagIds: number[] | null
  orgIds: number[] | null
  orgFilterMode?: 'include-people' | 'direct-only'
  statusIds?: number[] | null
  /** Which date field to filter on. 'due' is accepted as a legacy value and translated to 'date' at load time. */
  dateField?: DateField
  /** ISO string of date range start (optional for backward compat) */
  dateRangeStart?: string | null
  /** ISO string of date range end (optional for backward compat) */
  dateRangeEnd?: string | null
  /** Renamed from dateRangeIncludeNoDue. Translation layer reads both keys on load; serializer writes only this key. */
  dateRangeIncludeNoDate: boolean
}

export interface SavedView {
  id?: number
  name: string
  sortBy: ListSortBy
  filters: SavedViewFilters
  sortOrder: number
}

export type PersistedSavedView = SavedView & { id: number }
