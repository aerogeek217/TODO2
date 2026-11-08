import type { FilterAtom, FilterExpr } from '../../models/filter-expression'
import { mentionToken, quoteText, statusToken, tagToken } from '../name-tokens'
import { dateClauseWords } from './dates'

/**
 * Writes a filter expression as text in its canonical form — what the
 * editor shows once a typed expression reads, and what summaries show:
 * names by their tokens (`@Aisha`, `@"Aisha Rahman"`), text quoted
 * (`"budget review"`), keywords lower case, an `and` / `or` inside another
 * always in parentheses, and Show completed as a last `and done`.
 * `parseExpression` reads it back as the same tree.
 */

/** The names of the people, tags and statuses an expression names by id. */
export interface ExpressionNames {
  person: (id: number) => string | undefined
  tag: (id: number) => string | undefined
  status: (id: number) => string | undefined
}

/** A name for an id that no longer exists (the term then names nobody: it reads as an error until fixed). */
const GONE = { person: 'deleted person', tag: 'deleted tag', status: 'deleted status' } as const

function atomText(a: FilterAtom, names: ExpressionNames): string {
  switch (a.kind) {
    case 'person': return a.id === 0 ? 'no person' : mentionToken(names.person(a.id) ?? GONE.person)
    case 'tag': return a.id === 0 ? 'no tag' : tagToken(names.tag(a.id) ?? GONE.tag)
    case 'status': return a.id === 0 ? 'no status' : statusToken(names.status(a.id) ?? GONE.status)
    case 'priority': return a.value === 'none' ? 'no priority' : `/${a.value}`
    // A quote inside is escaped (`\"`), so the text reads back as itself.
    case 'text': return quoteText(a.text)
    case 'date': return dateClauseWords(a.field, a.match)
  }
}

/** `not x` of a "none" atom reads as its "any": `any person`, `any priority`. */
function anyText(item: FilterExpr): string | null {
  if (item.kind === 'person' || item.kind === 'tag' || item.kind === 'status') return item.id === 0 ? `any ${item.kind}` : null
  if (item.kind === 'priority') return item.value === 'none' ? 'any priority' : null
  return null
}

/** Whether a term is written in parentheses where it stands inside another `and` / `or` / `not`. */
function grouped(e: FilterExpr): boolean {
  return e.kind === 'and' || e.kind === 'or' || (e.kind === 'date' && dateClauseWords(e.field, e.match).startsWith('('))
}

function nodeText(e: FilterExpr, names: ExpressionNames, nested: boolean): string {
  switch (e.kind) {
    case 'and':
    case 'or': {
      const text = e.items.map((item) => nodeText(item, names, true)).join(` ${e.kind} `)
      return nested ? `(${text})` : text
    }
    case 'not': {
      const any = anyText(e.item)
      if (any) return any
      const inner = nodeText(e.item, names, true)
      return grouped(e.item) || e.item.kind === 'not' ? `not ${inner.startsWith('(') ? inner : `(${inner})`}` : `not ${inner}`
    }
    default:
      return atomText(e, names)
  }
}

/** One term as text (a top-level term, a summary's line). */
export function printTerm(e: FilterExpr, names: ExpressionNames): string {
  return nodeText(e, names, false)
}

/** The whole filter as text (see the module comment); `''` for no filter. */
export function printExpression(expression: FilterExpr | null | undefined, showCompleted: boolean, names: ExpressionNames): string {
  if (!expression) return showCompleted ? 'done' : ''
  if (!showCompleted) return nodeText(expression, names, false)
  return `${nodeText(expression, names, expression.kind === 'or')} and done`
}
