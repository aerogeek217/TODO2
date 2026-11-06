import type { DateField } from './app-view'
import type { DateMatch, MarkerValue } from './filter-predicate'

/**
 * A filter written as an expression (`TodoPredicate.expression`): terms
 * joined by and / or / not, each term one of the things a chip can say —
 * a person, a tag, a status, a priority, a date clause, text the task
 * contains. Stored by id, so a rename rewrites the text it prints as
 * (`utils/filter-expression.printExpression`).
 *
 * - `and` with no item keeps every task, `or` with none keeps none (neither
 *   is ever written: `normalizeExpression` folds them away).
 * - A `date` atom's match is a plain clause: Any / None (`set` / `unset`)
 *   or a range without its "is not" and "or none" (`not` / `includeNoDate`):
 *   those are `not` and `or … no due` nodes here.
 * - `id` 0 is the "none" choice, as in the id filters: Unassigned, No tags,
 *   No status; a priority's `none` is no marker.
 */
export type FilterExpr = FilterExprAnd | FilterExprOr | FilterExprNot | FilterAtom

export interface FilterExprAnd { kind: 'and'; items: FilterExpr[] }
export interface FilterExprOr { kind: 'or'; items: FilterExpr[] }
export interface FilterExprNot { kind: 'not'; item: FilterExpr }

export type FilterAtom =
  | { kind: 'person'; id: number }
  | { kind: 'tag'; id: number }
  | { kind: 'status'; id: number }
  | { kind: 'priority'; value: MarkerValue }
  | { kind: 'text'; text: string }
  | { kind: 'date'; field: DateField; match: DateMatch }

export type FilterAtomKind = FilterAtom['kind']

/** The atoms that name an entity by id. */
export type IdAtomKind = 'person' | 'tag' | 'status'

/** Most nodes an expression holds (atoms and operators). */
export const EXPRESSION_NODES_MAX = 200

/** Deepest nesting an expression holds (the root is depth 1). */
export const EXPRESSION_DEPTH_MAX = 12

/** Longest text an expression's source may be (what the editor accepts). */
export const EXPRESSION_TEXT_MAX = 2000
