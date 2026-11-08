import { emptyFilterClauses, type FilterClauses, type TodoPredicate } from '../models/filter-predicate'
import { EXPRESSION_NODES_MAX, type FilterExpr } from '../models/filter-expression'
import { expressionSize, expressionToClauses, splitTopLevel, topLevelTerms, wholeExpression } from './filter-expression'
import { withNormalizedNegation } from './filter-negation'

/**
 * A predicate is Graphical (its clauses) or an expression
 * (`TodoPredicate.expression`). These read either the same way:
 *
 * - `topLevelPredicate` — the predicate's own clauses, or an expression's
 *   top-level `and` terms that are chips (`splitTopLevel`): what a new
 *   task's seeds, a Prompt for pick, the People / Tag group narrowing and a
 *   pane drop read (an `or`, or any other term, seeds nothing: which of
 *   its alternatives a new task should meet is ambiguous);
 * - `expressionRest` — the other terms;
 * - `asExpression` / `asGraphical` — the editor's switch.
 */

/** `p` with no clause of its own (Show completed and the rest kept). */
function withoutClauses<T extends TodoPredicate>(p: T): T {
  const { negate: _negate, ...rest } = p
  void _negate
  return { ...rest, ...emptyFilterClauses() } as T
}

/** The clauses a reader of `p`'s top level reads (see the module comment), as a Graphical predicate. */
export function topLevelPredicate(p: TodoPredicate): TodoPredicate {
  if (!p.expression) return p
  const { expression: _expression, ...rest } = p
  void _expression
  const clauses: FilterClauses = splitTopLevel(p.expression).clauses
  return withNormalizedNegation({ ...withoutClauses(rest), ...clauses })
}

/** `p`'s top-level terms that aren't chips (none for a Graphical predicate). */
export function expressionRest(p: Pick<TodoPredicate, 'expression'>): FilterExpr[] {
  return p.expression ? splitTopLevel(p.expression).rest : []
}

/**
 * `p` written as an expression: everything it narrows by — its clauses and
 * expression — as one tree; Show completed kept. A predicate
 * that narrows by nothing has no expression (it is "every task" either way).
 * Null past `EXPRESSION_NODES_MAX` nodes (a chip of thousands of values):
 * the switch refuses it, as no expression that size is read back.
 */
export function asExpression<T extends TodoPredicate>(p: T): T | null {
  const expression = wholeExpression(p)
  if (expression && expressionSize(expression) > EXPRESSION_NODES_MAX) return null
  const out = withoutClauses(p)
  if (expression) return { ...out, expression }
  const { expression: _expression, ...plain } = out
  void _expression
  return plain as T
}

/** `p` with `expression` as its filter (null: no filter), its clauses gone. */
export function withExpression<T extends TodoPredicate>(p: T, expression: FilterExpr | null, showCompleted = p.showCompleted): T {
  const out = { ...withoutClauses(p), showCompleted }
  if (expression) return { ...out, expression }
  const { expression: _expression, ...plain } = out
  void _expression
  return plain as T
}

/**
 * Whether `e` has a Completed date range that can only keep completed tasks
 * where none are let in: inside an `or` (or under a `not`'s `not`), with no
 * Completed range among its top-level terms and no Show completed
 * (`filter-criteria.admitsCompleted`) — `completed this week or completed
 * last week` keeps nothing (cr33 F10).
 */
export function completedOnlyInside(e: FilterExpr, showCompleted: boolean): boolean {
  if (showCompleted) return false
  const top = topLevelTerms(e)
  if (top.some((t) => t.kind === 'date' && t.field === 'completed')) return false
  const positive = (n: FilterExpr, negated: boolean): boolean => {
    if (n.kind === 'not') return positive(n.item, !negated)
    if (n.kind === 'and' || n.kind === 'or') return n.items.some((item) => positive(item, negated))
    return !negated && n.kind === 'date' && n.field === 'completed' && n.match.match === 'range'
  }
  return top.some((t) => positive(t, false))
}

/** `p` as Graphical clauses, or null when its expression has a term no chip says. */
export function asGraphical<T extends TodoPredicate>(p: T): T | null {
  if (!p.expression) return p
  const clauses = expressionToClauses(p.expression)
  if (!clauses) return null
  const { expression: _expression, ...rest } = p
  void _expression
  return withNormalizedNegation({ ...withoutClauses(rest as T), ...clauses }) as T
}
