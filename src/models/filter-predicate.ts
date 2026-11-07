import type { DateField } from './app-view'
import type { FilterExpr } from './filter-expression'

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
  | 'start-of-last-week'
  | 'end-of-last-week'
  | 'start-of-last-month'
  | 'end-of-last-month'

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
  'start-of-last-week',
  'end-of-last-week',
  'start-of-last-month',
  'end-of-last-month',
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
 *   task without that date passes too. With `not` ("is not", schema v71;
 *   every type but Completed) the date, as a day, is outside [start, end],
 *   and a task without the date passes.
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
  /** Also keep tasks without the date (due date / follow-up only; not stored with `not`, which keeps them anyway). */
  includeNoDate?: boolean
  /**
   * "Is not" (schema v71): the task's date, as a day, is outside [start,
   * end]; a task without the date passes (as "Tags is not X" keeps
   * untagged tasks). Stored only when true, never on Completed
   * (`NEGATABLE_DATE_FIELDS`).
   */
  not?: true
}

/**
 * The date filters, one clause per date type: a task must pass every clause
 * (AND). An absent key = that type doesn't filter; `{}` = no date filter.
 */
export type DateFilters = Partial<Record<DateField, DateMatch>>

/**
 * The date types a task may lack that offer Any / None (`set` / `unset`) and "also
 * tasks with no date": the due date, the next follow-up, the last follow-up.
 * Completed is a range only (Show completed already says has / has not), and
 * its range lets completed tasks through (`utils/filter-criteria.admitsCompleted`).
 */
export const OPTIONAL_DATE_FIELDS: readonly DateField[] = ['deadline', 'followup', 'lastFollowup']

/**
 * The date types whose range has an "is not" (`DateRangeMatch.not`): all but
 * Completed — its range lets completed tasks through
 * (`utils/filter-criteria.admitsCompleted`), and a negated one isn't defined.
 */
export const NEGATABLE_DATE_FIELDS: readonly DateField[] = ['deadline', 'followup', 'lastFollowup', 'created', 'modified']

/** Longest text filter a stored list keeps (its "Text contains" input has the same limit). */
export const PREDICATE_SEARCH_TEXT_MAX = 500

/** A task marker the Markers filter can require. */
export type MarkerKey = 'urgent' | 'important' | 'focus'

/** Markers in display order (Focus › Urgent › Important). */
export const MARKER_KEYS: readonly MarkerKey[] = ['focus', 'urgent', 'important']

/**
 * What a Priority filter asks of each marker: `true` = the task must have it
 * (Yes), `false` = it must not (No), absent = either (Any). An empty object
 * tests nothing. Also the flags a filter seeds on new tasks (`false` = off).
 */
export type MarkerConditions = { [K in MarkerKey]?: boolean }

/** A Priority filter's "none" choice: a task with no marker (as Status's `No status`). */
export const NO_PRIORITY = 'none'

/** What a Priority condition can name: a marker, or no marker at all. */
export type MarkerValue = MarkerKey | typeof NO_PRIORITY

/**
 * One Priority condition, one chip: the task is (or, `not`, isn't) any of
 * `values`, as a Status filter reads. `urgent` means effective urgent —
 * flagged, or due within the Settings range (`utils/urgency.ts`), so `is not
 * Urgent` also leaves out tasks urgent by their due date.
 */
export interface MarkerClause {
  values: MarkerValue[]
  not?: true
}

/**
 * The Priority filter: its conditions, each a chip. Among a predicate's own
 * clauses a task must pass them all (`is Urgent` and `is Important`); in an or
 * group one is enough, as any of the group's clauses.
 */
export type MarkersFilter = MarkerClause[]

/** The most Priority conditions one set of clauses holds. */
export const MARKER_CLAUSES_MAX = 10

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
  /**
   * Completed tasks pass too. A Completed date range among the clauses (or
   * a top-level term of the expression) lets them through as well — the ones
   * it keeps (`utils/filter-criteria.admitsCompleted`).
   */
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
   * Priority filter: its conditions, a chip each (`MarkersFilter`).
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
  /**
   * The filter as an expression (`models/filter-expression`): a task must
   * pass it as well. A predicate is Graphical (its clauses: a chip per
   * field, a chip per Priority condition, all ANDed) or an expression:
   * while this is present its own clauses are empty (`pickPredicate` folds
   * any into it; schema v75 made each stored filter with or groups one). Show completed stays the predicate's (`and done` in the text).
   * Absent = Graphical.
   */
  expression?: FilterExpr
}

/**
 * The narrowing clauses of a predicate — what a chip can be: one clause per
 * field, "is not" per id field, no Show completed. The predicate's own
 * clauses have this shape (a `TodoPredicate` is one).
 */
export type FilterClauses = Pick<TodoPredicate, 'personIds' | 'statusIds' | 'tags' | 'searchText' | 'dates' | 'markers' | 'negate'>

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

/** Clauses that filter nothing. */
export function emptyFilterClauses(): FilterClauses {
  return {
    personIds: null,
    statusIds: null,
    searchText: '',
    dates: {},
    markers: null,
    tags: null,
  }
}
