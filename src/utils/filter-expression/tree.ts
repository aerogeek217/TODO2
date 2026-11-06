import type { FilterAtom, FilterExpr } from '../../models/filter-expression'

/**
 * Tree helpers for `FilterExpr`: its normal form, size and depth, and a walk
 * over its atoms.
 */

/**
 * `e` in its normal form, which two equal filters share: an `and` inside an
 * `and` (an `or` inside an `or`) is spread into it, a one-item `and` / `or`
 * is its item, `not not x` is `x`. An empty `and` / `or` is kept (the
 * callers never build one).
 */
export function normalizeExpression(e: FilterExpr): FilterExpr {
  switch (e.kind) {
    case 'and':
    case 'or': {
      const items: FilterExpr[] = []
      for (const item of e.items) {
        const n = normalizeExpression(item)
        if (n.kind === e.kind) items.push(...n.items)
        else items.push(n)
      }
      return items.length === 1 && items[0] ? items[0] : { kind: e.kind, items }
    }
    case 'not': {
      const item = normalizeExpression(e.item)
      return item.kind === 'not' ? item.item : { kind: 'not', item }
    }
    default:
      return e
  }
}

/** How many nodes `e` holds (atoms and operators). */
export function expressionSize(e: FilterExpr): number {
  switch (e.kind) {
    case 'and':
    case 'or': return 1 + e.items.reduce((n, item) => n + expressionSize(item), 0)
    case 'not': return 1 + expressionSize(e.item)
    default: return 1
  }
}

/** How deep `e` nests (an atom is 1). */
export function expressionDepth(e: FilterExpr): number {
  switch (e.kind) {
    case 'and':
    case 'or': return 1 + Math.max(0, ...e.items.map(expressionDepth))
    case 'not': return 1 + expressionDepth(e.item)
    default: return 1
  }
}

/** Every atom of `e`, in order. */
export function expressionAtoms(e: FilterExpr): FilterAtom[] {
  switch (e.kind) {
    case 'and':
    case 'or': return e.items.flatMap(expressionAtoms)
    case 'not': return expressionAtoms(e.item)
    default: return [e]
  }
}

/** The terms of `e`'s top-level `and` (`e` itself when it isn't one). */
export function topLevelTerms(e: FilterExpr): readonly FilterExpr[] {
  return e.kind === 'and' ? e.items : [e]
}

/** Whether two expressions are the same filter in normal form. */
export function expressionsEqual(a: FilterExpr | null | undefined, b: FilterExpr | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null
  return JSON.stringify(normalizeExpression(a)) === JSON.stringify(normalizeExpression(b))
}
