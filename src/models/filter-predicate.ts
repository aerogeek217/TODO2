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

/**
 * A date filter on one date type:
 *
 * - `range` — the task's date, as a day, is within [start, end] (either end
 *   open; a range with neither end is no filter and isn't stored). With
 *   `includeNoDate` (due date / follow-up only, stored only when true) a
 *   task without that date passes too.
 * - `set` / `unset` — the date is set / empty (due date / follow-up only:
 *   every task has a created and a modified date).
 */
export type DateMatch =
  | DateRangeMatch
  | { match: 'set' }
  | { match: 'unset' }

export interface DateRangeMatch {
  match: 'range'
  /** Lower bound, resolved at evaluation time; null = open. */
  start: DateAnchor | null
  /** Upper bound (the whole day), resolved at evaluation time; null = open. */
  end: DateAnchor | null
  /** Also keep tasks without the date (due date / follow-up only). */
  includeNoDate?: boolean
}

/**
 * The date filters, one clause per date type: a task must pass every clause
 * (AND). An absent key = that type doesn't filter; `{}` = no date filter.
 */
export type DateFilters = Partial<Record<DateField, DateMatch>>

/** The date types a task may lack: they offer Has a date / No date and "also tasks with no date". */
export const OPTIONAL_DATE_FIELDS: readonly DateField[] = ['deadline', 'followup']

/** Longest text filter a stored list keeps (its "Text contains" input has the same limit). */
export const PREDICATE_SEARCH_TEXT_MAX = 500

/** A task marker the Markers filter can require. */
export type MarkerKey = 'urgent' | 'important' | 'focus'

/** Markers in display order (Focus › Urgent › Important). */
export const MARKER_KEYS: readonly MarkerKey[] = ['focus', 'urgent', 'important']

/**
 * A set of markers: only `true` values are stored, an empty object is none.
 * One line of the Hot rule (a task has every marker of the line).
 */
export type MarkerSet = { [K in MarkerKey]?: true }

/**
 * What a Priority filter asks of each marker: `true` = the task must have it
 * (Yes), `false` = it must not (No), absent = either (Any). An empty object
 * tests nothing. Also the flags a filter seeds on new tasks (`false` = off).
 */
export type MarkerConditions = { [K in MarkerKey]?: boolean }

/** The Markers filter's Hot choice: the task must be hot (Settings' Hot rule, `utils/hot.ts`). */
export const HOT_MARKERS = 'hot'

/**
 * The Markers (Priority) filter: either `'hot'` — the task must be hot — or
 * a condition per marker, all of which must hold (strict AND): e.g. Urgent
 * Yes and Important No. `urgent` means effective urgent — flagged, or due
 * within the Settings range (`utils/urgency.ts`), so Urgent No also leaves
 * out tasks urgent by their due date. Hot excludes the single markers.
 */
export type MarkersFilter = typeof HOT_MARKERS | MarkerConditions

/** The id filters an "is not" switch can turn round: people, status, tags. */
export type NegatableField = 'personIds' | 'statusIds' | 'tags'

/** The negatable id filters in display order of their pickers' fields (People, Status, Tags). */
export const NEGATABLE_FIELDS: readonly NegatableField[] = ['personIds', 'statusIds', 'tags']

/**
 * Which id filters read "is not": only `true` values are stored, and only
 * for a field that filters (a non-empty id list). Absent = every field "is".
 *
 * - Status is not {…}: the task's status (0 = no status) is not ticked.
 * - People is not {…}: the task has none of the ticked people (0 =
 *   unassigned, so "is not Unassigned" = has someone).
 * - Tags is not {…}: the task has none of the ticked tags (0 = no tags, so
 *   "is not No tags" = has a tag; otherwise untagged passes).
 */
export type FilterNegation = { [K in NegatableField]?: true }

/**
 * Serializable predicate describing the live filter fields.
 *
 * Shape is JSON-friendly: number arrays (not Sets), and `DateAnchor`s for the
 * date ranges (a fixed date, a relative token or a day offset, resolved at
 * evaluation time).
 * Stored unchanged inside a list definition's `membership.predicate`, then
 * converted to the runtime `FilterCriteria` shape at evaluation time.
 */
export interface TodoPredicate {
  showCompleted: boolean
  /**
   * null = no filter (all shown); array = only tasks with one of those people
   * shown (0 = "unassigned" sentinel) — or, with `negate.personIds`, only
   * tasks with none of them.
   */
  personIds: number[] | null
  /** null = no filter; array = only those statuses (0 = no status), or with `negate.statusIds` all but those. */
  statusIds: number[] | null
  searchText: string
  /** The date filters, one clause per date type (AND); `{}` = none. */
  dates: DateFilters
  /**
   * Markers (Priority) filter: Hot, or Yes / No per marker (Focus / Urgent /
   * Important, strict AND); null or absent = no filter. Optional on read.
   */
  markers?: MarkersFilter | null
  /**
   * null = no filter; array of tag ids (into the `tags` registry) with OR
   * semantics (todo must have at least one assigned tag in the set; 0 = "no
   * tags" sentinel, which an untagged todo matches). A todo with no tag
   * assignments is excluded when this clause is a non-empty array without 0.
   * Optional on read so pre-tags predicates (stored in `listDefinitions` /
   * `savedViews`) deserialize as `tags: null` without a data rewrite.
   * With `negate.tags`: only tasks with none of the tags (untagged passes).
   */
  tags?: number[] | null
  /**
   * The "is not" switches of the id filters (`personIds` / `statusIds` /
   * `tags`); absent = every field "is". Optional on read: older predicates
   * have none.
   */
  negate?: FilterNegation
}

/** Empty predicate — matches every open task (completed tasks need `showCompleted`). */
export function emptyPredicate(): TodoPredicate {
  return {
    showCompleted: false,
    personIds: null,
    statusIds: null,
    searchText: '',
    dates: {},
    markers: null,
    tags: null,
  }
}
