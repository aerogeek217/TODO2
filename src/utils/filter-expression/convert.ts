import { DATE_FIELD_VALUES, type DateField } from '../../models/app-view'
import type { FilterExpr, IdAtomKind } from '../../models/filter-expression'
import {
  MARKER_CLAUSES_MAX,
  NEGATABLE_DATE_FIELDS,
  OPTIONAL_DATE_FIELDS,
  emptyFilterClauses,
  type DateMatch,
  type FilterClauses,
  type MarkerClause,
  type MarkerValue,
  type NegatableField,
  type TodoPredicate,
} from '../../models/filter-predicate'
import { normalizeExpression, topLevelTerms } from './tree'

/**
 * Graphical filters (a chip per field, all ANDed) ↔ expressions.
 *
 * - `clausesToExpression`: a set of clauses as the expression that filters
 *   the same — Graphical → Expression always converts.
 * - `splitTopLevel`: an expression's top-level `and` terms read as chips
 *   where a term is one (`clauses`), the others kept as terms (`rest`) —
 *   what the readers of a filter's top level read (new
 *   tasks' seeds, a Prompt for pick, People / Tag group narrowing, a pane
 *   drop).
 * - `expressionToClauses`: the clauses when every term is a chip (Expression
 *   → Graphical), else null.
 */

const ID_FIELD: Record<IdAtomKind, NegatableField> = { person: 'personIds', tag: 'tags', status: 'statusIds' }
const ID_KIND: Record<NegatableField, IdAtomKind> = { personIds: 'person', tags: 'tag', statusIds: 'status' }

/** `items` as one term: the item itself, or an `or` of them. */
function anyOf(items: FilterExpr[]): FilterExpr {
  return items.length === 1 && items[0] ? items[0] : { kind: 'or', items }
}

/** An id filter's term: `@a or @b`, turned round by its "is not". Null when nothing is ticked. */
function idTerm(field: NegatableField, ids: readonly number[] | null | undefined, not: boolean): FilterExpr | null {
  if (!ids || ids.length === 0) return null
  const kind = ID_KIND[field]
  const term = anyOf(ids.map((id): FilterExpr => ({ kind, id })))
  return not ? { kind: 'not', item: term } : term
}

function markerTerm(clause: MarkerClause): FilterExpr | null {
  if (clause.values.length === 0) return null
  const term = anyOf(clause.values.map((value): FilterExpr => ({ kind: 'priority', value })))
  return clause.not ? { kind: 'not', item: term } : term
}

/** A date clause's term: its range as an atom, "is not" a `not`, "or none" an `or … no due`. */
function dateTerm(field: DateField, m: DateMatch): FilterExpr {
  if (m.match !== 'range') return { kind: 'date', field, match: m }
  const atom: FilterExpr = { kind: 'date', field, match: { match: 'range', start: m.start, end: m.end } }
  if (m.not === true) return { kind: 'not', item: atom }
  if (m.includeNoDate === true) return { kind: 'or', items: [atom, { kind: 'date', field, match: { match: 'unset' } }] }
  return atom
}

/**
 * The expression that filters as `c` does (Show completed aside: that is
 * the predicate's own flag); null when `c` filters nothing. Terms in the
 * chips' order: priority, tags, people, dates, status, text. An id filter
 * with nothing ticked (it keeps no task; the editors never leave one) is
 * left out.
 */
export function clausesToExpression(c: FilterClauses): FilterExpr | null {
  const terms: FilterExpr[] = []
  for (const clause of c.markers ?? []) {
    const t = markerTerm(clause)
    if (t) terms.push(t)
  }
  for (const field of ['tags', 'personIds'] as const) {
    const t = idTerm(field, c[field], c.negate?.[field] === true)
    if (t) terms.push(t)
  }
  for (const field of DATE_FIELD_VALUES) {
    const m = c.dates?.[field]
    if (m) terms.push(dateTerm(field, m))
  }
  const status = idTerm('statusIds', c.statusIds, c.negate?.statusIds === true)
  if (status) terms.push(status)
  const text = (c.searchText ?? '').trim()
  if (text) terms.push({ kind: 'text', text })
  if (terms.length === 0) return null
  return normalizeExpression(terms.length === 1 && terms[0] ? terms[0] : { kind: 'and', items: terms })
}

/** One chip's clause: which field it fills and the clauses with it filled in. */
type ChipClause = (c: FilterClauses) => FilterClauses | null

/** The ids of `term` when it is one id atom or an `or` of atoms of one kind. */
function idsOf(term: FilterExpr): { kind: IdAtomKind | 'priority'; ids: number[]; values: MarkerValue[] } | null {
  const atoms = term.kind === 'or' ? term.items : [term]
  const first = atoms[0]
  if (!first) return null
  if (first.kind === 'priority') {
    const values: MarkerValue[] = []
    for (const a of atoms) {
      if (a.kind !== 'priority') return null
      values.push(a.value)
    }
    return { kind: 'priority', ids: [], values }
  }
  if (first.kind !== 'person' && first.kind !== 'tag' && first.kind !== 'status') return null
  const ids: number[] = []
  for (const a of atoms) {
    if (a.kind !== first.kind) return null
    ids.push(a.id)
  }
  return { kind: first.kind, ids, values: [] }
}

/** `term` as a chip, or null when no chip says it. */
function chipOf(term: FilterExpr, markerChips: number): ChipClause | null {
  const not = term.kind === 'not'
  const inner = term.kind === 'not' ? term.item : term
  const ids = idsOf(inner)
  if (ids?.kind === 'priority') {
    const clause: MarkerClause = not ? { values: ids.values, not: true } : { values: ids.values }
    return (c) => ((c.markers?.length ?? 0) >= markerChips ? null : { ...c, markers: [...(c.markers ?? []), clause] })
  }
  if (ids) {
    const field = ID_FIELD[ids.kind as IdAtomKind]
    return (c) => {
      if (c[field] != null) return null
      const next: FilterClauses = { ...c, [field]: ids.ids }
      return not ? { ...next, negate: { ...c.negate, [field]: true } } : next
    }
  }
  if (inner.kind === 'text' && !not) return (c) => ((c.searchText ?? '').trim() !== '' ? null : { ...c, searchText: inner.text })
  const date = dateChip(inner, not)
  if (date) {
    const [field, m] = date
    return (c) => (c.dates?.[field] ? null : { ...c, dates: { ...c.dates, [field]: m } })
  }
  return null
}

/** A date term as one date clause: an atom, `not` a range (an "is not"), `range or none` (an "or none"). */
function dateChip(term: FilterExpr, not: boolean): [DateField, DateMatch] | null {
  if (term.kind === 'date') {
    if (!not) return [term.field, term.match]
    if (term.match.match === 'range' && NEGATABLE_DATE_FIELDS.includes(term.field)) return [term.field, { ...term.match, not: true }]
    return null
  }
  if (not || term.kind !== 'or' || term.items.length !== 2) return null
  const [a, b] = term.items
  if (a?.kind !== 'date' || b?.kind !== 'date' || a.field !== b.field || !OPTIONAL_DATE_FIELDS.includes(a.field)) return null
  const rangeOf = a.match.match === 'range' && b.match.match === 'unset' ? a.match
    : b.match.match === 'range' && a.match.match === 'unset' ? b.match : null
  return rangeOf && rangeOf.match === 'range' ? [a.field, { ...rangeOf, includeNoDate: true }] : null
}

export interface SplitExpression {
  /** The top-level terms that are chips, as clauses. */
  clauses: FilterClauses
  /** The other top-level terms. */
  rest: FilterExpr[]
}

/**
 * `e`'s top-level `and` terms: each that is a chip and fits among the
 * clauses so far (one per field; up to `markerChips` Priority chips) is
 * among `clauses`, every other one in `rest`.
 */
export function splitTopLevel(e: FilterExpr | null | undefined, { markerChips = MARKER_CLAUSES_MAX }: { markerChips?: number } = {}): SplitExpression {
  let clauses: FilterClauses = emptyFilterClauses()
  const rest: FilterExpr[] = []
  if (!e) return { clauses, rest }
  for (const term of topLevelTerms(normalizeExpression(e))) {
    const chip = chipOf(term, markerChips)
    const next = chip?.(clauses) ?? null
    if (next) clauses = next
    else rest.push(term)
  }
  return { clauses, rest }
}

/**
 * The ids of each top-level `and` term of `e` that is an "is" pick of `kind`
 * — `@a`, or `@a or @b` —, one list per term, in order: `@a and @b` is
 * `[[a], [b]]`, a task needing both. `splitTopLevel` reads only the first
 * such term as the field's chip (Graphical holds one per field); the seeds
 * and the People / Tag group narrowing read them all (cr33 F12). An "is
 * not" term (`not @a`) isn't one.
 */
export function topLevelIdPicks(e: FilterExpr | null | undefined, kind: 'person' | 'tag'): number[][] {
  if (!e) return []
  const out: number[][] = []
  for (const term of topLevelTerms(normalizeExpression(e))) {
    const ids = idsOf(term)
    if (ids?.kind === kind) out.push(ids.ids)
  }
  return out
}

/** `e` as Graphical clauses, or null when a term isn't a chip. */
export function expressionToClauses(e: FilterExpr | null | undefined): FilterClauses | null {
  const { clauses, rest } = splitTopLevel(e)
  return rest.length === 0 ? clauses : null
}

/** An or group as one term: any of its clauses. Null when it has none. */
export function orGroupTerm(group: FilterClauses): FilterExpr | null {
  const e = clausesToExpression(group)
  if (!e) return null
  return e.kind === 'and' ? { kind: 'or', items: e.items } : e
}

/**
 * Everything `p` narrows by as one expression — its own clauses, each or
 * group (a stored predicate from before v75, read defensively) as an `or`
 * of its clauses, and its expression, ANDed — or null when it narrows by
 * nothing. Show completed is not part of it.
 */
export function wholeExpression(
  p: Pick<TodoPredicate, 'personIds' | 'statusIds' | 'tags' | 'searchText' | 'dates' | 'markers' | 'negate' | 'expression'>,
  orGroups: readonly FilterClauses[] = [],
): FilterExpr | null {
  const terms: FilterExpr[] = []
  const own = clausesToExpression(p)
  if (own) terms.push(own)
  for (const group of orGroups) {
    const t = orGroupTerm(group)
    if (t) terms.push(t)
  }
  if (p.expression) terms.push(p.expression)
  if (terms.length === 0) return null
  return normalizeExpression(terms.length === 1 && terms[0] ? terms[0] : { kind: 'and', items: terms })
}
