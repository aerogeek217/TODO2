import type { DateField } from './app-view'

export type OrgFilterMode = 'include-people' | 'direct-only'
export type PersonFilterMode = 'include-orgs' | 'direct-only'

/**
 * Relative-date tokens resolve to a concrete Date at eval time against "today"
 * and the user's `weekStartsOn`. Authoring a predicate with a relative anchor
 * (e.g. `end-of-week`) keeps the filter correct across midnight rollovers
 * without rewriting the stored predicate.
 */
export type RelativeDateToken =
  | 'yesterday'
  | 'today'
  | 'tomorrow'
  | 'start-of-week'
  | 'end-of-week'
  | 'start-of-next-week'
  | 'end-of-next-week'
  | 'start-of-month'
  | 'end-of-month'
  | 'start-of-next-month'
  | 'end-of-next-month'
  | 'end-of-month-plus-3'

export const RELATIVE_DATE_TOKENS: readonly RelativeDateToken[] = [
  'yesterday',
  'today',
  'tomorrow',
  'start-of-week',
  'end-of-week',
  'start-of-next-week',
  'end-of-next-week',
  'start-of-month',
  'end-of-month',
  'start-of-next-month',
  'end-of-next-month',
  'end-of-month-plus-3',
]

/**
 * Serializable date-range anchor. `fixed` matches the legacy ISO-string
 * behavior; `relative` carries a token that resolves against today at eval time.
 */
export type DateAnchor =
  | { kind: 'fixed'; iso: string }
  | { kind: 'relative'; token: RelativeDateToken }

/**
 * Serializable predicate describing the live filter fields. Intentionally does
 * NOT include @deprecated legacy keys (`priorities`, `completedFilter`, etc.)
 * — those live only on `SavedViewFilters` for backward-compat.
 *
 * Shape is JSON-friendly: number arrays (not Sets), and `DateAnchor` for date
 * range (either a fixed ISO string or a relative token resolved at eval time).
 * Stored unchanged inside `ListDefinition.custom` and `SavedViewFilters`, then
 * converted to the runtime `FilterCriteria` shape at evaluation time.
 */
export interface TodoPredicate {
  showCompleted: boolean
  showHiddenStatuses: boolean
  /** null = no filter (all shown); array = only those IDs shown (0 = "unassigned" sentinel) */
  personIds: number[] | null
  personFilterMode: PersonFilterMode
  orgIds: number[] | null
  orgFilterMode: OrgFilterMode
  /** null = no filter; array = only todos in these projects shown (0 = "no project" sentinel) */
  projectIds: number[] | null
  statusIds: number[] | null
  searchText: string
  dateField: DateField
  /** Fixed ISO string or relative token; null = no lower bound. */
  dateRangeStart: DateAnchor | null
  dateRangeEnd: DateAnchor | null
  dateRangeIncludeNoDate: boolean
  /** Tri-state presence filter on `scheduledDate`. null = no filter. */
  hasScheduled: boolean | null
  /** Tri-state presence filter on `dueDate`. null = no filter. */
  hasDeadline: boolean | null
  /**
   * null = no filter; array of normalized tag slugs with OR semantics (todo
   * must have at least one tag in the set). A todo with no tags is excluded
   * when this clause is a non-empty array. Optional on read so pre-tags
   * predicates (stored in `listDefinitions` / `savedViews`) deserialize as
   * `tags: null` without a data rewrite.
   */
  tags?: string[] | null
}
