import { DATE_FIELD_VALUES, type DateField } from '../models'
import {
  HOT_MARKERS,
  MARKER_KEYS,
  PREDICATE_SEARCH_TEXT_MAX,
  RELATIVE_DATE_TOKENS,
  type DateAnchor,
  type MarkerSet,
  type MarkersFilter,
  type RelativeDateToken,
  type TodoPredicate,
} from '../models/filter-predicate'

/**
 * Shape check + reconstruction of a stored list predicate (`TodoPredicate`,
 * inside `ListDefinition.membership`).
 *
 * - `checkPredicateShape` — the core shape import validation requires (a
 *   predicate failing it fails the import, as it always has).
 * - `pickPredicate` — rebuilds a predicate from its known keys only. A
 *   malformed id filter (people / statuses / tags) or Markers filter is
 *   dropped — no filter — and a too-long text filter is shortened; both are
 *   reported in `dropped`, so import can warn and the audit can report. The
 *   core fields fall back to their defaults when malformed (only reachable
 *   for rows already in the database: import rejects those), so a bad stored
 *   predicate can't crash the lists showing it.
 */

export { PREDICATE_SEARCH_TEXT_MAX }

/**
 * Most ids an id filter can hold: every row of a full table (the import's
 * record cap) plus the "unassigned" sentinel `0`.
 */
export const PREDICATE_ID_LIST_MAX = 100_001

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isOptTriBool(v: unknown): boolean {
  return v === undefined || v === null || typeof v === 'boolean'
}

function isDateLike(v: unknown): boolean {
  return typeof v === 'string' && !isNaN(Date.parse(v))
}

/** A valid stored anchor, rebuilt from its known keys; `undefined` when malformed. */
function readAnchor(v: unknown): DateAnchor | undefined {
  if (!isObj(v)) return undefined
  if (v.kind === 'fixed' && isDateLike(v.iso)) return { kind: 'fixed', iso: v.iso as string }
  if (v.kind === 'relative' && typeof v.token === 'string' && (RELATIVE_DATE_TOKENS as readonly string[]).includes(v.token)) {
    return { kind: 'relative', token: v.token as RelativeDateToken }
  }
  if (v.kind === 'offset' && typeof v.days === 'number' && Number.isFinite(v.days)) return { kind: 'offset', days: v.days }
  return undefined
}

function isOptAnchor(v: unknown): boolean {
  return v === undefined || v === null || readAnchor(v) !== undefined
}

function isDateField(v: unknown): v is DateField {
  return (DATE_FIELD_VALUES as readonly unknown[]).includes(v)
}

/**
 * `true` when `v` has the core predicate shape import requires, else the
 * name of the first bad field. The id filters, the Markers filter and the
 * text filter's length are not checked here: `pickPredicate` sanitises them.
 */
export function checkPredicateShape(v: unknown): true | string {
  if (!isObj(v)) return 'predicate'
  if (typeof v.showCompleted !== 'boolean') return 'showCompleted'
  if (typeof v.searchText !== 'string') return 'searchText'
  if (typeof v.dateRangeIncludeNoDate !== 'boolean') return 'dateRangeIncludeNoDate'
  if (!isOptAnchor(v.dateRangeStart)) return 'dateRangeStart'
  if (!isOptAnchor(v.dateRangeEnd)) return 'dateRangeEnd'
  if (v.dateField !== undefined && !isDateField(v.dateField)) return 'dateField'
  if (!isOptTriBool(v.hasDeadline)) return 'hasDeadline'
  if (!isOptTriBool(v.hasFollowup)) return 'hasFollowup'
  return true
}

/** What `pickPredicate` dropped or changed, in words (`people filter dropped`, …). */
export type PredicateFix = string

/** An id filter: `null` (no filter), or an array of finite numbers within the cap; `undefined` when malformed. */
function readIdList(v: unknown): number[] | null | undefined {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v) || v.length > PREDICATE_ID_LIST_MAX) return undefined
  for (const id of v) if (typeof id !== 'number' || !Number.isFinite(id)) return undefined
  return [...(v as number[])]
}

/** A Markers filter: `'hot'` or an object of known markers set to `true`; `undefined` when malformed. */
function readMarkers(v: unknown): MarkersFilter | null | undefined {
  if (v === null) return null
  if (v === HOT_MARKERS) return HOT_MARKERS
  if (!isObj(v)) return undefined
  const out: MarkerSet = {}
  for (const [k, val] of Object.entries(v)) {
    if (!(MARKER_KEYS as readonly string[]).includes(k) || val !== true) return undefined
    out[k as keyof MarkerSet] = true
  }
  return out
}

export interface PickedPredicate {
  predicate: TodoPredicate
  /** The malformed parts dropped (or shortened); empty for a clean predicate. */
  fixes: PredicateFix[]
}

/**
 * Rebuilds a stored predicate from its known keys (unknown keys go). Optional
 * fields (`hasFollowup`, `markers`, `tags`) stay absent when absent; a
 * required one that is missing gets its default. See the module comment for
 * what is dropped and reported.
 */
export function pickPredicate(raw: unknown): PickedPredicate {
  const fixes: PredicateFix[] = []
  const v: Obj = isObj(raw) ? raw : {}
  if (!isObj(raw)) fixes.push('filters reset')

  const ids = (value: unknown, what: string): number[] | null => {
    const list = readIdList(value)
    if (list !== undefined) return list
    fixes.push(`${what} filter dropped`)
    return null
  }
  const core = <T>(ok: boolean, value: T, fallback: T, what: string): T => {
    if (ok) return value
    if (isObj(raw)) fixes.push(`${what} reset`)
    return fallback
  }

  let searchText = core(typeof v.searchText === 'string', v.searchText as string, '', 'text filter')
  if (searchText.length > PREDICATE_SEARCH_TEXT_MAX) {
    searchText = searchText.slice(0, PREDICATE_SEARCH_TEXT_MAX)
    fixes.push('text filter shortened')
  }
  const anchor = (value: unknown, what: string): DateAnchor | null => {
    if (value === undefined || value === null) return null
    // The legacy form, an ISO string (as the filter store reads it too).
    if (isDateLike(value)) return { kind: 'fixed', iso: value as string }
    const a = readAnchor(value)
    if (a) return a
    if (isObj(raw)) fixes.push(`${what} reset`)
    return null
  }

  const predicate: TodoPredicate = {
    showCompleted: core(typeof v.showCompleted === 'boolean', v.showCompleted as boolean, false, 'show completed'),
    personIds: ids(v.personIds, 'people'),
    statusIds: ids(v.statusIds, 'status'),
    searchText,
    dateField: v.dateField === undefined ? 'deadline' : core(isDateField(v.dateField), v.dateField as DateField, 'deadline', 'date field'),
    dateRangeStart: anchor(v.dateRangeStart, 'date range start'),
    dateRangeEnd: anchor(v.dateRangeEnd, 'date range end'),
    dateRangeIncludeNoDate: core(typeof v.dateRangeIncludeNoDate === 'boolean', v.dateRangeIncludeNoDate as boolean, false, 'include no date'),
    hasDeadline: core(isOptTriBool(v.hasDeadline), (v.hasDeadline ?? null) as boolean | null, null, 'due date filter'),
  }
  if ('hasFollowup' in v) {
    predicate.hasFollowup = core(isOptTriBool(v.hasFollowup), (v.hasFollowup ?? null) as boolean | null, null, 'follow-up filter')
  }
  if ('markers' in v && v.markers !== undefined) {
    const markers = readMarkers(v.markers)
    if (markers === undefined) fixes.push('markers filter dropped')
    predicate.markers = markers ?? null
  }
  if ('tags' in v && v.tags !== undefined) predicate.tags = ids(v.tags, 'tag')
  return { predicate, fixes }
}
