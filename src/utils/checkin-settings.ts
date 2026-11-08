import { emptyPredicate, type FilterClauses, type TodoPredicate } from '../models/filter-predicate'
import type { FilterAtom, FilterExpr } from '../models/filter-expression'
import { expressionAtoms, topLevelTerms } from './filter-expression'
import { withExpression } from './predicate-expression'
import { predicatesEqual } from './list-def-equal'

/**
 * Email check-in settings: how a check-in email is handed to the mail app,
 * and which of a person's open tasks it covers. Both are remembered in the
 * `settings` table (`checkinOpenMethod`, `checkinTaskFilter`).
 */

/**
 * `mailto`: open a `mailto:` link (To + Subject) and put the body on the
 * clipboard to paste. `eml`: download an unsent `.eml` draft.
 */
export type CheckinOpenMethod = 'mailto' | 'eml'

export const CHECKIN_OPEN_METHODS: readonly CheckinOpenMethod[] = ['mailto', 'eml']

export const DEFAULT_CHECKIN_OPEN_METHOD: CheckinOpenMethod = 'mailto'

export function isCheckinOpenMethod(value: unknown): value is CheckinOpenMethod {
  return (CHECKIN_OPEN_METHODS as readonly unknown[]).includes(value)
}

/**
 * Which of a person's open tasks a check-in covers: a list predicate,
 * evaluated as a List widget evaluates its filter, over the person's open
 * tasks. It has no people filter (a check-in is per person) and never
 * shows completed tasks; `emptyPredicate()` = all their open tasks.
 */
export type CheckinTaskFilter = TodoPredicate

/** Clauses without their people filter (nor its "is not" switch). */
function withoutPeople<T extends FilterClauses>(c: T): T {
  const out: T = { ...c, personIds: null }
  if (c.negate) {
    const { personIds: _personIds, ...others } = c.negate
    void _personIds
    if (Object.keys(others).length > 0) out.negate = others
    else delete out.negate
  }
  return out
}

/** Clauses without a Completed date range (nor its type's key). */
function withoutCompletedDate<T extends FilterClauses>(c: T): T {
  if (!('completed' in c.dates)) return c
  const { completed: _completed, ...dates } = c.dates
  void _completed
  return { ...c, dates }
}

/** Clauses as a check-in keeps them: no people filter, no Completed range. */
const checkinClauses = <T extends FilterClauses>(c: T): T => withoutCompletedDate(withoutPeople(c))

/** A term as a check-in reads it: always true, always false, unknown (it names a person), or a filter left. */
type Folded = { kind: 'true' } | { kind: 'false' } | { kind: 'unknown' } | { kind: 'expr'; e: FilterExpr }

const TRUE: Folded = { kind: 'true' }
const FALSE: Folded = { kind: 'false' }
const UNKNOWN: Folded = { kind: 'unknown' }

/**
 * `e` over one person's open tasks — what a check-in covers. `no person` is
 * false there (each task has that person), a Completed date is false (an
 * open task has none; `completed none` true); they fold away, the rest
 * kept: `#q4 or no person` is `#q4`. A person (`@Ann`) depends on whom the
 * check-in is for: unknown.
 */
function fold(e: FilterExpr): Folded {
  switch (e.kind) {
    case 'person': return e.id === 0 ? FALSE : UNKNOWN
    case 'date':
      if (e.field !== 'completed') return { kind: 'expr', e }
      return e.match.match === 'unset' ? TRUE : FALSE
    case 'not': {
      const f = fold(e.item)
      if (f.kind === 'true') return FALSE
      if (f.kind === 'false') return TRUE
      return f.kind === 'unknown' ? UNKNOWN : { kind: 'expr', e: { kind: 'not', item: f.e } }
    }
    case 'and':
    case 'or': {
      // The value that decides the whole (false for and, true for or).
      const decides = e.kind === 'and' ? 'false' : 'true'
      const items: FilterExpr[] = []
      let unknown = false
      for (const item of e.items) {
        const f = fold(item)
        if (f.kind === decides) return f
        if (f.kind === 'unknown') unknown = true
        else if (f.kind === 'expr') items.push(f.e)
      }
      if (unknown) return UNKNOWN
      if (items.length === 0) return e.kind === 'and' ? TRUE : FALSE
      return { kind: 'expr', e: items.length === 1 && items[0] ? items[0] : { kind: e.kind, items } }
    }
    default:
      return { kind: 'expr', e }
  }
}

/** Whether `predicate` (or its expression) has a Completed date clause, which a check-in drops. */
export function hasCompletedDateClause(predicate: TodoPredicate): boolean {
  return predicate.dates.completed !== undefined
    || (predicate.expression != null && expressionAtoms(predicate.expression).some((a) => a.kind === 'date' && a.field === 'completed'))
}

/**
 * The check-in filter as it is kept: no people filter (nor its "is not"
 * switch) and no Completed date range (a check-in only takes open tasks, so
 * it would match none), completed tasks off. In an expression each
 * top-level term is read over a person's open tasks (`fold`, cr33 F11):
 * `no person` and the Completed dates fold away where the term's meaning
 * allows (`(#q4 or no person)` is `#q4`; a term then always true goes); a
 * term naming a person (`@Ann`) goes whole, as a people chip does (its
 * reader reports it, `checkinFilterDrops`); a term always false (`no person
 * and #q4`) is kept as it is — it keeps no task, as it says — so the filter
 * never widens silently, and the field shows the term refused.
 */
export function checkinFilterOf(predicate: TodoPredicate): CheckinTaskFilter {
  if (predicate.expression) {
    const terms: FilterExpr[] = []
    for (const term of topLevelTerms(predicate.expression)) {
      const f = fold(term)
      if (f.kind === 'expr') terms.push(f.e)
      else if (f.kind === 'false') terms.push(term)
    }
    const kept: FilterExpr | null = terms.length === 0 ? null : terms.length === 1 ? (terms[0] ?? null) : { kind: 'and', items: terms }
    return withExpression(predicate, kept, false)
  }
  return { ...checkinClauses(predicate), showCompleted: false }
}

/** How many atoms of `e` pass `test`. */
function atomCount(e: FilterExpr | undefined, test: (a: FilterAtom) => boolean): number {
  return e ? expressionAtoms(e).filter(test).length : 0
}

const isPersonAtom = (a: FilterAtom) => a.kind === 'person'
const isCompletedAtom = (a: FilterAtom) => a.kind === 'date' && a.field === 'completed'

/**
 * What `checkinFilterOf` takes out of `predicate`, in words for a fix
 * (`people filter dropped`, `completed date filter dropped`, `show completed
 * dropped`) — an expression's person terms too (cr33 D3); empty when nothing.
 */
export function checkinFilterDrops(predicate: TodoPredicate): string[] {
  const kept = checkinFilterOf(predicate)
  const out: string[] = []
  if (predicate.personIds != null || atomCount(predicate.expression, isPersonAtom) > atomCount(kept.expression, isPersonAtom)) {
    out.push('people filter dropped')
  }
  if (predicate.dates.completed !== undefined || atomCount(predicate.expression, isCompletedAtom) > atomCount(kept.expression, isCompletedAtom)) {
    out.push('completed date filter dropped')
  }
  if (predicate.showCompleted) out.push('show completed dropped')
  return out
}

/** Whether the check-in filter narrows nothing (all open tasks). */
export function isNoCheckinFilter(filter: CheckinTaskFilter): boolean {
  return predicatesEqual(checkinFilterOf(filter), emptyPredicate())
}

/** Whether two check-in filters pick the same tasks. */
export function checkinFiltersEqual(a: CheckinTaskFilter, b: CheckinTaskFilter): boolean {
  return predicatesEqual(checkinFilterOf(a), checkinFilterOf(b))
}

/** The "How to open it" choices, as the check-in dialog and Settings show them. */
export const CHECKIN_OPEN_METHOD_OPTIONS: ReadonlyArray<{ method: CheckinOpenMethod; label: string; help: string }> = [
  { method: 'mailto', label: 'Open in mail app, then paste', help: 'To + Subject filled in; body copied. New and classic Outlook.' },
  { method: 'eml', label: 'Download draft (.eml)', help: 'Opens ready to send in classic Outlook. No paste.' },
]
