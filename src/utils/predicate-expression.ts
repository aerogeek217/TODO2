import { emptyFilterClauses, type FilterClauses, type TodoPredicate } from '../models/filter-predicate'
import { EXPRESSION_NODES_MAX, type FilterExpr } from '../models/filter-expression'
import { expressionSize, expressionToClauses, splitTopLevel, wholeExpression } from './filter-expression'
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

/** Whether `p` is written as an expression. */
export function isExpressionPredicate(p: Pick<TodoPredicate, 'expression'>): boolean {
  return p.expression != null
}

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

/** `p` as Graphical clauses, or null when its expression has a term no chip says. */
export function asGraphical<T extends TodoPredicate>(p: T): T | null {
  if (!p.expression) return p
  const clauses = expressionToClauses(p.expression)
  if (!clauses) return null
  const { expression: _expression, ...rest } = p
  void _expression
  return withNormalizedNegation({ ...withoutClauses(rest as T), ...clauses }) as T
}
