import type { DateField } from './app-view'

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
 * behavior; `relative` carries a named token; `offset` carries an integer
 * day-count from today (negative = past, positive = future) for arbitrary
 * windows like "stale > 7 days" that don't map to a named token.
 */
export type DateAnchor =
  | { kind: 'fixed'; iso: string }
  | { kind: 'relative'; token: RelativeDateToken }
  | { kind: 'offset'; days: number }

/** Longest text filter a stored list keeps (its "Text contains" input has the same limit). */
export const PREDICATE_SEARCH_TEXT_MAX = 500

/** A task marker the Markers filter can require. */
export type MarkerKey = 'urgent' | 'important' | 'focus'

/** Markers in display order (Urgent › Important › Focus). */
export const MARKER_KEYS: readonly MarkerKey[] = ['urgent', 'important', 'focus']

/**
 * A set of markers: only `true` values are stored, an empty object is none.
 * A Markers filter's ticked markers, one line of the Hot rule, the flags a
 * filter seeds on new tasks.
 */
export type MarkerSet = { [K in MarkerKey]?: true }

/** The Markers filter's Hot choice: the task must be hot (Settings' Hot rule, `utils/hot.ts`). */
export const HOT_MARKERS = 'hot'

/**
 * The Markers filter: either `'hot'` — the task must be hot — or a set of
 * markers the task must **all** have (strict AND). `urgent` means effective
 * urgent — flagged, or due within the Settings range (`utils/urgency.ts`).
 * Hot excludes picking single markers.
 */
export type MarkersFilter = typeof HOT_MARKERS | MarkerSet

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
  /** null = no filter (all shown); array = only those IDs shown (0 = "unassigned" sentinel) */
  personIds: number[] | null
  statusIds: number[] | null
  searchText: string
  dateField: DateField
  /** Fixed ISO string or relative token; null = no lower bound. */
  dateRangeStart: DateAnchor | null
  dateRangeEnd: DateAnchor | null
  /** With `dateField === 'deadline'`: also keep tasks that have no due date. */
  dateRangeIncludeNoDate: boolean
  /** Tri-state presence filter on `dueDate`. null = no filter. */
  hasDeadline: boolean | null
  /**
   * Tri-state presence filter on `nextFollowupAt`. null = no filter. Optional
   * on read so predicates stored before the field existed deserialize as
   * `null` without a data rewrite.
   */
  hasFollowup?: boolean | null
  /**
   * Markers filter (Hot, or Urgent / Important / Focus with strict AND);
   * null or absent = no filter. Optional on read.
   */
  markers?: MarkersFilter | null
  /**
   * null = no filter; array of tag ids (into the `tags` registry) with OR
   * semantics (todo must have at least one assigned tag in the set). A todo
   * with no tag assignments is excluded when this clause is a non-empty array.
   * Optional on read so pre-tags predicates (stored in `listDefinitions` /
   * `savedViews`) deserialize as `tags: null` without a data rewrite.
   */
  tags?: number[] | null
}

/** Empty predicate — matches every open task (completed tasks need `showCompleted`). */
export function emptyPredicate(): TodoPredicate {
  return {
    showCompleted: false,
    personIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'deadline',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasDeadline: null,
    hasFollowup: null,
    markers: null,
    tags: null,
  }
}
