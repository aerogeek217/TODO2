import { DATE_FIELD_VALUES, type DateField } from '../models'
import {
  MARKER_CLAUSES_MAX,
  NO_PRIORITY,
  MARKER_KEYS,
  NEGATABLE_DATE_FIELDS,
  NEGATABLE_FIELDS,
  OPTIONAL_DATE_FIELDS,
  PREDICATE_SEARCH_TEXT_MAX,
  RELATIVE_DATE_TOKENS,
  type DateAnchor,
  type DateFilters,
  type DateMatch,
  type FilterClauses,
  type FilterNegation,
  type MarkerClause,
  type MarkersFilter,
  type NegatableField,
  type RelativeDateToken,
  type TodoPredicate,
} from '../models/filter-predicate'
import { hasFilterClause, normalizeClauses } from '../utils/filter-clauses'
import { EXPRESSION_DEPTH_MAX, EXPRESSION_NODES_MAX, type FilterExpr } from '../models/filter-expression'
import { expressionDepth, expressionSize, normalizeExpression, wholeExpression } from '../utils/filter-expression'
import { withExpression } from '../utils/predicate-expression'
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
 *   switch is dropped. Or groups (stored before v75, which made each filter
 *   with them an expression) are read the same way (their own clauses,
 *   their own fixes) and folded into the expression; a malformed or group —
 *   or `orGroups` that isn't an array — is dropped, and or groups past
 *   `OR_GROUPS_READ_MAX` go. The
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
  lastFollowup: 'last follow-up date',
  completed: 'completed date',
  created: 'created date',
  modified: 'modified date',
}

/**
 * One stored date clause for `field`, rebuilt from its known keys; `null`
 * for a range with neither end (no filter, not stored), `undefined` when
 * malformed — an unknown `match`, a bad range end, `includeNoDate` or
 * `not` (not a boolean), Any / None (`set` / `unset`) on a type that is a range only
 * (completed, created, modified), or an "is not" on Completed's range (not
 * defined there; dropping only the switch would turn the filter round, so
 * the clause goes). `includeNoDate` is kept only when true, on the optional
 * types (`OPTIONAL_DATE_FIELDS`), and not beside `not` (a negated range
 * keeps undated tasks anyway; dropped silently); on Completed's range it is
 * dropped with a fix (the range stays: it keeps completed tasks only).
 * `not` is kept only when true.
 */
function readDateMatch(field: DateField, v: unknown, fixes: PredicateFix[]): DateMatch | null | undefined {
  if (!isRecord(v)) return undefined
  const optional = OPTIONAL_DATE_FIELDS.includes(field)
  if (v.match === 'set' || v.match === 'unset') return optional ? { match: v.match } : undefined
  if (v.match !== 'range') return undefined
  const start = readRangeEnd(v.start)
  const end = readRangeEnd(v.end)
  if (start === undefined || end === undefined) return undefined
  if (v.includeNoDate !== undefined && typeof v.includeNoDate !== 'boolean') return undefined
  if (v.not !== undefined && typeof v.not !== 'boolean') return undefined
  if (start === null && end === null) return null
  const not = v.not === true
  if (not && !NEGATABLE_DATE_FIELDS.includes(field)) return undefined
  if (field === 'completed' && v.includeNoDate === true) fixes.push(`${DATE_FILTER_WORDS[field]} filter's "or none" dropped`)
  if (not) return { match: 'range', start, end, not: true }
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
    const m = readDateMatch(key, clause, fixes)
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
 * A Priority filter: a list of conditions, each `values` naming known markers
 * or `No priority` and an optional `not`; `undefined` when malformed (an
 * unknown value or any other shape drops the whole filter — which way it
 * filtered is unknown).
 */
function readMarkers(v: unknown): MarkersFilter | null | undefined {
  if (v === null) return null
  if (!Array.isArray(v)) return undefined
  const known = (x: unknown) => x === NO_PRIORITY || (MARKER_KEYS as readonly unknown[]).includes(x)
  const out: MarkerClause[] = []
  for (const c of v as unknown[]) {
    if (!isRecord(c) || !Array.isArray(c.values) || !c.values.every(known)) return undefined
    if (c.not !== undefined && typeof c.not !== 'boolean') return undefined
    out.push({ values: c.values as MarkerClause['values'], ...(c.not === true ? { not: true as const } : {}) })
  }
  return out
}

export interface PickedPredicate {
  predicate: TodoPredicate
  /** The malformed parts dropped (or shortened); empty for a clean predicate. */
  fixes: PredicateFix[]
}

/**
 * The narrowing clauses of a stored predicate (or of an old or group), rebuilt from
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
    if (markers === undefined) {
      fixes.push('priority filter dropped')
      clauses.markers = null
    } else if (markers !== null && markers.length > 0) {
      // As the filter reads it (`normalizeMarkersFilter`), so the cap reported
      // is the one stored: a condition naming nothing goes, a value repeated
      // goes, conditions past `MARKER_CLAUSES_MAX` go. Values keep their order.
      const named = markers.flatMap((c) => {
        const values = [...new Set(c.values)]
        return values.length > 0 ? [{ ...c, values }] : []
      })
      if (named.length > MARKER_CLAUSES_MAX) fixes.push('priority filter capped')
      clauses.markers = named.length > 0 ? named.slice(0, MARKER_CLAUSES_MAX) : null
    } else clauses.markers = markers ?? null
  }
  if ('tags' in v && v.tags !== undefined) clauses.tags = ids(v.tags, 'tag')
  readNegation(v.negate, clauses, fixes)
  // An "is not" with nothing ticked is no filter; a switch on a field that doesn't filter goes.
  return withNormalizedNegation(clauses)
}

/** Most or groups read from a predicate stored before v75 (what a v74 build held). */
const OR_GROUPS_READ_MAX = 30

/**
 * The or groups of a predicate stored before v75 (absent since: v75 made
 * them an expression; a file or draft past the pipeline has none): `undefined` when absent (or `null`); an array of
 * records, each read with `pickClauses` (its fixes reported once each) into
 * its stored form (`normalizeClauses`). An `orGroups` that isn't an array is
 * dropped (`or groups dropped`); an item that isn't a record, or whose every
 * clause was malformed, is dropped (`or group dropped` / `N or groups dropped`);
 * an or group with no clause filters nothing and goes silently; or groups past
 * `OR_GROUPS_READ_MAX` go (`or groups capped`, not read).
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
    if (orGroups.length >= OR_GROUPS_READ_MAX) {
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
 * clauses (`pickClauses`), Show completed and its expression
 * (`readExpression`). A required field that is missing gets its default.
 * An expression, or old or groups, make the whole filter an expression
 * (`wholeExpression`): the clauses fold into it — unless the whole would be
 * past the expression caps, when the expression (and the or groups) are
 * dropped with a fix and the clauses stay clauses. See the module comment
 * for what is dropped and reported.
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
  const orGroups = pickOrGroups(v.orGroups, fixes) ?? []
  const expression = readExpression(v.expression, fixes)
  if (expression || orGroups.length > 0) {
    const whole = wholeExpression({ ...predicate, ...(expression ? { expression } : {}) }, orGroups)
    // The clauses folded in can take the whole past the caps a stored
    // expression is read within (`readExpression`): written so, the next read
    // dropped it and the filter kept every task, unreported (cr34 S3). The
    // expression (and the or groups) go on this read instead, reported, and
    // the clauses stay as they are — what is stored reads back the same.
    if (whole && (expressionSize(whole) > EXPRESSION_NODES_MAX || expressionDepth(whole) > EXPRESSION_DEPTH_MAX)) {
      if (expression) fixes.push('expression dropped')
      if (orGroups.length > 0) fixes.push('or groups dropped')
      return { predicate, fixes }
    }
    return { predicate: withExpression(predicate, whole), fixes }
  }
  return { predicate, fixes }
}

/** An expression this build can't read: the whole expression goes (which way it filtered is unknown). */
class BadExpression extends Error {}

/** How far a stored expression's read has got: the nodes read so far (`EXPRESSION_NODES_MAX`). */
interface ReadBudget { nodes: number }

/**
 * One node of a stored expression (`TodoPredicate.expression`), rebuilt from
 * its known keys; throws `BadExpression` on anything it can't read. A date
 * atom's "is not" and "or none" become `not` / `or … none` nodes; a text
 * longer than the cap is shortened (one fix). `depth` is the node's (the
 * root's 1): past `EXPRESSION_DEPTH_MAX`, or past `EXPRESSION_NODES_MAX`
 * nodes read, it throws before reading further, so a deep or wide stored
 * tree is refused, never a `RangeError` (cr33 S3).
 */
function readExpressionNode(v: unknown, fixes: PredicateFix[], depth: number, budget: ReadBudget): FilterExpr {
  if (depth > EXPRESSION_DEPTH_MAX || ++budget.nodes > EXPRESSION_NODES_MAX) throw new BadExpression()
  if (!isRecord(v)) throw new BadExpression()
  switch (v.kind) {
    case 'and':
    case 'or': {
      if (!Array.isArray(v.items) || v.items.length === 0 || v.items.length > EXPRESSION_NODES_MAX) throw new BadExpression()
      const items: FilterExpr[] = []
      for (const item of v.items as unknown[]) items.push(readExpressionNode(item, fixes, depth + 1, budget))
      return { kind: v.kind, items }
    }
    case 'not':
      return { kind: 'not', item: readExpressionNode(v.item, fixes, depth + 1, budget) }
    case 'person':
    case 'tag':
    case 'status': {
      const id = v.id
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) throw new BadExpression()
      return { kind: v.kind, id }
    }
    case 'priority': {
      const value = v.value
      if (value !== NO_PRIORITY && !(MARKER_KEYS as readonly unknown[]).includes(value)) throw new BadExpression()
      return { kind: 'priority', value: value as MarkerClause['values'][number] }
    }
    case 'text': {
      if (typeof v.text !== 'string' || v.text.trim() === '') throw new BadExpression()
      const text = v.text.trim()
      if (text.length <= PREDICATE_SEARCH_TEXT_MAX) return { kind: 'text', text }
      fixes.push('text filter shortened')
      return { kind: 'text', text: text.slice(0, PREDICATE_SEARCH_TEXT_MAX) }
    }
    case 'date': {
      if (!isDateField(v.field)) throw new BadExpression()
      const field = v.field
      const m = readDateMatch(field, v.match, fixes)
      if (!m) throw new BadExpression()
      if (m.match !== 'range') return { kind: 'date', field, match: m }
      const atom: FilterExpr = { kind: 'date', field, match: { match: 'range', start: m.start, end: m.end } }
      if (m.not === true) return { kind: 'not', item: atom }
      if (m.includeNoDate === true) return { kind: 'or', items: [atom, { kind: 'date', field, match: { match: 'unset' } }] }
      return atom
    }
    default:
      throw new BadExpression()
  }
}

/**
 * The stored expression in its normal form; `undefined` when absent (or
 * `null`) or dropped — anything it can't read, or past the caps
 * (`EXPRESSION_NODES_MAX`, `EXPRESSION_DEPTH_MAX`: the editor's, so what
 * the editor and v75 write reads back), drops it with a fix.
 */
function readExpression(raw: unknown, fixes: PredicateFix[]): FilterExpr | undefined {
  if (raw === undefined || raw === null) return undefined
  const own: PredicateFix[] = []
  try {
    const e = normalizeExpression(readExpressionNode(raw, own, 1, { nodes: 0 }))
    if (expressionSize(e) > EXPRESSION_NODES_MAX || expressionDepth(e) > EXPRESSION_DEPTH_MAX) throw new BadExpression()
    fixes.push(...own)
    return e
  } catch (err) {
    if (!(err instanceof BadExpression)) throw err
    fixes.push('expression dropped')
    return undefined
  }
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
