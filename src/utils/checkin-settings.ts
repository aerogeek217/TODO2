import { emptyPredicate, type FilterClauses, type TodoPredicate } from '../models/filter-predicate'
import type { FilterExpr } from '../models/filter-expression'
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

/** Whether an expression term names a person or a Completed date, which a check-in drops. */
function checkinDrops(term: FilterExpr): boolean {
  return expressionAtoms(term).some((a) => a.kind === 'person' || (a.kind === 'date' && a.field === 'completed'))
}

/** Whether `predicate` (or its expression) has a Completed date clause, which a check-in drops. */
export function hasCompletedDateClause(predicate: TodoPredicate): boolean {
  return predicate.dates.completed !== undefined
    || (predicate.expression != null && expressionAtoms(predicate.expression).some((a) => a.kind === 'date' && a.field === 'completed'))
}

/**
 * The check-in filter as it is kept: no people filter (nor its "is not"
 * switch) and no Completed date range (a check-in only takes open tasks, so
 * it would match none) — in an or group either, an or group left with no
 * clause dropped —, completed tasks off.
 */
export function checkinFilterOf(predicate: TodoPredicate): CheckinTaskFilter {
  if (predicate.expression) {
    // An expression's top-level terms that name a person or a Completed date go, whole.
    const terms = topLevelTerms(predicate.expression).filter((t) => !checkinDrops(t))
    const kept: FilterExpr | null = terms.length === 0 ? null : terms.length === 1 ? (terms[0] ?? null) : { kind: 'and', items: [...terms] }
    return withExpression(predicate, kept, false)
  }
  return { ...checkinClauses(predicate), showCompleted: false }
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
