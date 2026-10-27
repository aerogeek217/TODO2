import { DATE_FIELD_VALUES, type DateField } from '../models'
import {
  HOT_MARKERS,
  MARKER_KEYS,
  NEGATABLE_FIELDS,
  OPTIONAL_DATE_FIELDS,
  PREDICATE_SEARCH_TEXT_MAX,
  RELATIVE_DATE_TOKENS,
  type DateAnchor,
  type DateFilters,
  type DateMatch,
  OR_GROUPS_MAX,
  type FilterClauses,
  type FilterNegation,
  type MarkerConditions,
  type MarkerKey,
  type MarkersFilter,
  type NegatableField,
  type RelativeDateToken,
  type TodoPredicate,
} from '../models/filter-predicate'
import { hasFilterClause, normalizeClauses } from '../utils/or-groups'
import { withNormalizedNegation } from '../utils/filter-negation'
import { isRecord } from '../utils/is-record'

/**
 * Shape check + reconstruction of a stored list predicate (`TodoPredicate`,
 * inside `ListDefinition.membership`).
 *
 * - `checkPredicateShape` — the core shape import validation requires (a
 *   predicate failing it fails the import, as it always has).
 * - `pickPredicate` — rebuilds a predicate from its known keys only. A
 *   malformed id filter (people / statuses / tags), Priority filter or date
 *   clause (an unknown date type included) is dropped — no filter — and a
 *   too-long text filter is shortened; all are reported in `fixes`, so
 *   import can warn and the audit can report. An "is not" switch this build
 *   can't read drops the filter it switched (which way it filtered is
 *   unknown, so the filter goes rather than turning round); an unknown
 *   switch is dropped. Each or group is read the same way (its own
 *   clauses, their own fixes); a malformed or group — or `orGroups` that isn't an
 *   array — is dropped, and or groups past `OR_GROUPS_MAX` go. The
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

function isDateLike(v: unknown): boolean {
  return typeof v === 'string' && !isNaN(Date.parse(v))
}

/** A valid stored anchor, rebuilt from its known keys; `undefined` when malformed. */
function readAnchor(v: unknown): DateAnchor | undefined {
  if (!isRecord(v)) return undefined
  if (v.kind === 'fixed' && isDateLike(v.iso)) return { kind: 'fixed', iso: v.iso as string }
  if (v.kind === 'relative' && typeof v.token === 'string' && (RELATIVE_DATE_TOKENS as readonly string[]).includes(v.token)) {
    return { kind: 'relative', token: v.token as RelativeDateToken }
  }
  if (v.kind === 'offset' && typeof v.days === 'number' && Number.isFinite(v.days)) return { kind: 'offset', days: v.days }
  return undefined
}

/**
 * A range end: `null` (open) or an anchor; `undefined` when malformed. The
 * legacy ISO-string form counts as a `fixed` anchor (a 2026-04 build wrote
 * it into stored lists, where it may still be).
 */
function readRangeEnd(v: unknown): DateAnchor | null | undefined {
  if (v === undefined || v === null) return null
  if (isDateLike(v)) return { kind: 'fixed', iso: v as string }
  return readAnchor(v)
}

function isDateField(v: unknown): v is DateField {
  return (DATE_FIELD_VALUES as readonly unknown[]).includes(v)
}

/** A date type's name in a fix (`due date filter dropped`). */
const DATE_FILTER_WORDS: Record<DateField, string> = {
  deadline: 'due date',
  followup: 'follow-up date',
  created: 'created date',
  modified: 'modified date',
}

/**
 * One stored date clause for `field`, rebuilt from its known keys; `null`
 * for a range with neither end (no filter, not stored), `undefined` when
 * malformed — an unknown `match`, a bad range end or `includeNoDate`, or
 * Has a date / No date on a date every task has (created / modified).
 * `includeNoDate` is kept only when true, on the due date / follow-up.
 */
function readDateMatch(field: DateField, v: unknown): DateMatch | null | undefined {
  if (!isRecord(v)) return undefined
  const optional = OPTIONAL_DATE_FIELDS.includes(field)
  if (v.match === 'set' || v.match === 'unset') return optional ? { match: v.match } : undefined
  if (v.match !== 'range') return undefined
  const start = readRangeEnd(v.start)
  const end = readRangeEnd(v.end)
  if (start === undefined || end === undefined) return undefined
  if (v.includeNoDate !== undefined && typeof v.includeNoDate !== 'boolean') return undefined
  if (start === null && end === null) return null
  return { match: 'range', start, end, ...(optional && v.includeNoDate === true ? { includeNoDate: true } : {}) }
}

/**
 * The stored date filters: known date types with a well-formed clause, in
 * date-type order. Each clause dropped is named in `fixes`.
 */
function readDateFilters(v: Obj, fixes: PredicateFix[]): DateFilters {
  const out: DateFilters = {}
  for (const [key, clause] of Object.entries(v)) {
    if (!isDateField(key)) {
      fixes.push('unknown date filter dropped')
      continue
    }
    const m = readDateMatch(key, clause)
    if (m === undefined) fixes.push(`${DATE_FILTER_WORDS[key]} filter dropped`)
    else if (m) out[key] = m
  }
  const ordered: DateFilters = {}
  for (const field of DATE_FIELD_VALUES) {
    const m = out[field]
    if (m) ordered[field] = m
  }
  return ordered
}

/**
 * `true` when `v` has the core predicate shape import requires, else the
 * name of the first bad field: `showCompleted`, `searchText` and the date
 * filters map (`dates`, an object). The id filters, the Priority filter, the
 * date clauses inside `dates`, the text filter's length and the or
 * groups are not checked here: `pickPredicate` sanitises them.
 */
export function checkPredicateShape(v: unknown): true | string {
  if (!isRecord(v)) return 'predicate'
  if (typeof v.showCompleted !== 'boolean') return 'showCompleted'
  if (typeof v.searchText !== 'string') return 'searchText'
  if (!isRecord(v.dates)) return 'dates'
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

/**
 * A Markers filter: `'hot'` or an object of known markers set to `true` (Yes)
 * or `false` (No); `undefined` when malformed (an unknown marker or any other
 * value drops the whole filter — which way it filtered is unknown).
 */
function readMarkers(v: unknown): MarkersFilter | null | undefined {
  if (v === null) return null
  if (v === HOT_MARKERS) return HOT_MARKERS
  if (!isRecord(v)) return undefined
  const out: MarkerConditions = {}
  for (const [k, val] of Object.entries(v)) {
    if (!(MARKER_KEYS as readonly string[]).includes(k) || typeof val !== 'boolean') return undefined
    out[k as MarkerKey] = val
  }
  return out
}

export interface PickedPredicate {
  predicate: TodoPredicate
  /** The malformed parts dropped (or shortened); empty for a clean predicate. */
  fixes: PredicateFix[]
}

/**
 * The narrowing clauses of a stored predicate or of an or group, rebuilt from
 * their known keys (see the module comment for what is dropped and
 * reported). Optional fields (`markers`, `tags`) stay absent when absent;
 * a malformed text filter or date filters map is reset to no filter —
 * reported only with `reportReset` (a predicate that isn't a record at all
 * is one fix of its own).
 */
function pickClauses(v: Obj, fixes: PredicateFix[], reportReset: boolean): FilterClauses {
  const ids = (value: unknown, what: string): number[] | null => {
    const list = readIdList(value)
    if (list !== undefined) return list
    fixes.push(`${what} filter dropped`)
    return null
  }

  let searchText = ''
  if (typeof v.searchText === 'string') searchText = v.searchText
  else if (reportReset) fixes.push('text filter reset')
  if (searchText.length > PREDICATE_SEARCH_TEXT_MAX) {
    searchText = searchText.slice(0, PREDICATE_SEARCH_TEXT_MAX)
    fixes.push('text filter shortened')
  }
  let dates: DateFilters = {}
  if (isRecord(v.dates)) dates = readDateFilters(v.dates, fixes)
  else if (reportReset) fixes.push('date filters reset')

  const clauses: FilterClauses = {
    personIds: ids(v.personIds, 'people'),
    statusIds: ids(v.statusIds, 'status'),
    searchText,
    dates,
  }
  if ('markers' in v && v.markers !== undefined) {
    const markers = readMarkers(v.markers)
    if (markers === undefined) fixes.push('priority filter dropped')
    clauses.markers = markers ?? null
  }
  if ('tags' in v && v.tags !== undefined) clauses.tags = ids(v.tags, 'tag')
  readNegation(v.negate, clauses, fixes)
  // An "is not" with nothing ticked is no filter; a switch on a field that doesn't filter goes.
  return withNormalizedNegation(clauses)
}

/**
 * The stored or groups: `undefined` when absent (or `null`); an array of
 * records, each read with `pickClauses` (its fixes reported once each) into
 * its stored form (`normalizeClauses`). An `orGroups` that isn't an array is
 * dropped (`or groups dropped`); an item that isn't a record, or whose every
 * clause was malformed, is dropped (`or group dropped` / `N or groups dropped`);
 * an or group with no clause filters nothing and goes silently; or groups past
 * `OR_GROUPS_MAX` go (`or groups capped`, not read).
 */
function pickOrGroups(raw: unknown, fixes: PredicateFix[]): FilterClauses[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) {
    fixes.push('or groups dropped')
    return undefined
  }
  const orGroups: FilterClauses[] = []
  const clauseFixes = new Set<PredicateFix>()
  let dropped = 0
  let capped = false
  for (const item of raw as unknown[]) {
    if (orGroups.length >= OR_GROUPS_MAX) {
      capped = true
      break
    }
    if (!isRecord(item)) {
      dropped++
      continue
    }
    const own: PredicateFix[] = []
    const clauses = normalizeClauses(pickClauses(item, own, true))
    for (const fix of own) clauseFixes.add(fix)
    if (hasFilterClause(clauses)) orGroups.push(clauses)
    else if (own.length > 0) dropped++
  }
  fixes.push(...clauseFixes)
  if (dropped > 0) fixes.push(dropped === 1 ? 'or group dropped' : `${dropped} or groups dropped`)
  if (capped) fixes.push('or groups capped')
  return orGroups
}

/**
 * Rebuilds a stored predicate from its known keys (unknown keys go): its
 * clauses (`pickClauses`), Show completed, and its or groups
 * (`pickOrGroups`; the key only while one is left). A required field that is
 * missing gets its default. See the module comment for what is dropped and
 * reported.
 */
export function pickPredicate(raw: unknown): PickedPredicate {
  const fixes: PredicateFix[] = []
  const v: Obj = isRecord(raw) ? raw : {}
  if (!isRecord(raw)) fixes.push('filters reset')

  const clauses = pickClauses(v, fixes, isRecord(raw))
  let showCompleted = false
  if (typeof v.showCompleted === 'boolean') showCompleted = v.showCompleted
  else if (isRecord(raw)) fixes.push('show completed reset')
  const predicate: TodoPredicate = { showCompleted, ...clauses }
  const orGroups = pickOrGroups(v.orGroups, fixes)
  if (orGroups && orGroups.length > 0) predicate.orGroups = orGroups
  return { predicate, fixes }
}

/** An id filter's name in a fix (`people filter dropped`). */
const NEGATABLE_WORDS: Record<NegatableField, string> = {
  personIds: 'people',
  statusIds: 'status',
  tags: 'tag',
}

/**
 * Reads the stored "is not" switches into `predicate.negate` (a predicate's
 * clauses or an or group's). A switch is
 * `true`; `false`, `null` or absent = "is". Any other value on a known field
 * drops that field's filter (it can't tell which way the field filtered); a
 * `negate` that isn't an object drops every id filter that is set; an unknown
 * key is dropped. Each is named in `fixes`.
 */
function readNegation(raw: unknown, predicate: FilterClauses, fixes: PredicateFix[]): void {
  if (raw === undefined || raw === null) return
  const dropFilter = (field: NegatableField) => {
    if (predicate[field] == null) return
    predicate[field] = null
    fixes.push(`${NEGATABLE_WORDS[field]} filter dropped`)
  }
  if (!isRecord(raw)) {
    fixes.push('unknown "is not" switches dropped')
    for (const field of NEGATABLE_FIELDS) dropFilter(field)
    return
  }
  const negate: FilterNegation = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(NEGATABLE_FIELDS as readonly string[]).includes(key)) {
      fixes.push('unknown "is not" switch dropped')
      continue
    }
    const field = key as NegatableField
    if (value === true) negate[field] = true
    else if (value === false || value === null || value === undefined) continue
    else if (predicate[field] != null) dropFilter(field)
    else fixes.push('unknown "is not" switch dropped')
  }
  if (Object.keys(negate).length > 0) predicate.negate = negate
}
