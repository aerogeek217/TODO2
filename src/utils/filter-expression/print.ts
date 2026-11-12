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

/**
 * A stretch of a printed expression: one term (`atom`: its place among
 * `expressionAtoms`), the last `done` (Show completed), or the words between
 * them (`and`, `or`, `not`, parentheses, spaces).
 */
export interface ExpressionPiece {
  text: string
  /** The atom this piece is, by its index in `expressionAtoms` order. */
  atom?: number
  /** The atom itself (its kind picks the pill's tint). */
  term?: FilterAtom
  /** Show completed's `done`. */
  done?: true
}

/** `nodeText` in pieces: the same characters, each atom a piece of its own. */
function nodePieces(e: FilterExpr, names: ExpressionNames, nested: boolean, out: ExpressionPiece[], next: { atom: number }): void {
  const word = (text: string) => { if (text) out.push({ text }) }
  switch (e.kind) {
    case 'and':
    case 'or': {
      if (nested) word('(')
      e.items.forEach((item, i) => {
        if (i > 0) word(` ${e.kind} `)
        nodePieces(item, names, true, out, next)
      })
      if (nested) word(')')
      return
    }
    case 'not': {
      const any = anyText(e.item)
      // `any person`: the "none" atom under the `not`, as one piece.
      if (any && e.item.kind !== 'and' && e.item.kind !== 'or' && e.item.kind !== 'not') {
        out.push({ text: any, atom: next.atom++, term: e.item })
        return
      }
      // An `and` / `or` and a date that prints in parentheses bring their own; a `not` under it gets a pair.
      const wraps = e.item.kind === 'not'
      word(wraps ? 'not (' : 'not ')
      nodePieces(e.item, names, true, out, next)
      if (wraps) word(')')
      return
    }
    default:
      out.push({ text: atomText(e, names), atom: next.atom++, term: e })
  }
}

/**
 * The whole filter as `printExpression` writes it, in pieces — their texts
 * joined are that text — so a host can draw each term as a pill of its own.
 */
export function printPieces(expression: FilterExpr | null | undefined, showCompleted: boolean, names: ExpressionNames): ExpressionPiece[] {
  const out: ExpressionPiece[] = []
  if (expression) nodePieces(expression, names, showCompleted && expression.kind === 'or', out, { atom: 0 })
  if (showCompleted) {
    if (expression) out.push({ text: ' and ' })
    out.push({ text: 'done', done: true })
  }
  return out
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
