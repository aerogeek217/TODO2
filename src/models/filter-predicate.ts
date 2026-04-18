import type { DateField } from './app-view'

export type OrgFilterMode = 'include-people' | 'direct-only'
export type PersonFilterMode = 'include-orgs' | 'direct-only'

/**
 * Serializable predicate describing the live filter fields. Intentionally does
 * NOT include @deprecated legacy keys (`priorities`, `completedFilter`, etc.)
 * — those live only on `SavedViewFilters` for backward-compat.
 *
 * Shape is JSON-friendly: number arrays (not Sets) and ISO date strings (not
 * Date objects), so it can be stored unchanged inside `ListDefinition.custom`
 * and inside `SavedViewFilters`, then converted to the runtime `FilterCriteria`
 * shape at evaluation time.
 */
export interface TodoPredicate {
  showCompleted: boolean
  showHiddenStatuses: boolean
  /** null = no filter (all shown); array = only those IDs shown (0 = "unassigned" sentinel) */
  personIds: number[] | null
  personFilterMode: PersonFilterMode
  tagIds: number[] | null
  orgIds: number[] | null
  orgFilterMode: OrgFilterMode
  statusIds: number[] | null
  searchText: string
  dateField: DateField
  /** ISO date string (YYYY-MM-DD or full ISO); null = no lower bound. */
  dateRangeStart: string | null
  dateRangeEnd: string | null
  dateRangeIncludeNoDate: boolean
}
