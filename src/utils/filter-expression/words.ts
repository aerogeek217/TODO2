import type { DateField } from '../../models/app-view'
import type { FilterExpr } from '../../models/filter-expression'
import type { DateMatch } from '../../models/filter-predicate'
import { describeDateMatch } from '../date-words'
import { DATE_FIELD_LABELS_SHORT } from '../filter-labels'
import { MARKER_LABELS } from '../markers'
import { dateTypeIsOptional, periodOf } from './dates'
import type { ExpressionNames } from './print'
import { normalizeExpression } from './tree'

/**
 * A filter expression read back in words (D26 board BF) — what a list's
 * filter line shows for it, and the plain text every summary uses (a
 * lens's row and picker line, an Eisenhower pane's subtitle, a Number's
 * description, Copy from's list hints, a list's empty state). The exact
 * text stays the expression's (`printExpression`), for its tooltip.
 *
 * - Names are chips: a person (`Aisha`), a tag (`#q4`), a status
 *   (`Waiting`), a priority (`Urgent`).
 * - Everything else is a word term: a date as its Graphical chip says it
 *   (`due within the next 7 days`, `last follow-up 7+ days ago`), a named
 *   period by its name (`completed this month`), `overdue`, `follow-up
 *   late`; text as `mentions “invoice”`; the "none" choices (`unassigned`,
 *   `no tags`) and their "any" (`assigned`, `has a tag`).
 * - The top-level `and`'s terms are joined by ` · ` (a `not` term reads
 *   `not x`); a top-level `or` by `, or`; an `or` inside anything else is
 *   bracketed; an `and` inside an `or` joins by `and`, its `not` terms after
 *   `but not` (several: `but not a or b`). A date range `or` the same type's
 *   none reads as one term (`last follow-up 7+ days ago, or never`).
 * - The first letter is upper case when the line starts with a word term.
 */

/** A name chip's kind. */
export type WordNameKind = 'person' | 'tag' | 'status' | 'priority'

/**
 * One piece of the reading: a name chip, a word term or a joining word
 * (`·`, `,`, `or`, `and`, `not`, `but not`, `(`, `)`). `term` is the index
 * of the top-level term it belongs to (a ` · ` belongs to the term after it).
 */
export type WordPiece =
  | { kind: 'name'; name: WordNameKind; text: string; term: number }
  | { kind: 'word'; text: string; term: number }
  | { kind: 'joiner'; text: string; term: number }

export interface ExpressionWords {
  pieces: WordPiece[]
  /** How many top-level terms there are (1 unless the expression is an `and`). */
  terms: number
  /** The pieces as plain text: `(Aisha or Ben) · not #Ops`. */
  text: string
}

/** A name for an id that no longer exists (as `printExpression` says it). */
const GONE = { person: 'deleted person', tag: 'deleted tag', status: 'deleted status' } as const

/** A date type with Any (`due any`). */
const SET_WORDS: Record<DateField, string> = {
  deadline: 'has a due date',
  followup: 'has a next follow-up',
  lastFollowup: 'followed up',
  completed: 'completed any date',
  created: 'created any date',
  modified: 'modified any date',
}

/** A date type with None (`no due`, `never followed`). */
const UNSET_WORDS: Record<DateField, string> = {
  deadline: 'no due date',
  followup: 'no next follow-up',
  lastFollowup: 'never followed up',
  completed: 'not completed',
  created: 'no created date',
  modified: 'no modified date',
}

/** One date clause in words; `orNone`: or the type's none, as one term (`…, or never`). */
function dateWords(field: DateField, m: DateMatch, orNone = false): string {
  if (m.match === 'set') return SET_WORDS[field]
  if (m.match === 'unset') return UNSET_WORDS[field]
  const label = DATE_FIELD_LABELS_SHORT[field].toLowerCase()
  const none = orNone ? `, or ${field === 'lastFollowup' ? 'never' : 'none'}` : ''
  // The shortcuts the expression has words for (`overdue`, `followup late`): before today, no start.
  const beforeToday = m.start == null && m.end?.kind === 'relative' && m.end.token === 'yesterday'
  if (beforeToday && !orNone && field === 'deadline') return 'overdue'
  if (beforeToday && !orNone && field === 'followup') return 'follow-up late'
  const period = periodOf(m, field)
  if (period) return `${label} ${period}${none}`
  return `${label} ${describeDateMatch(m, field)}${none}`
}

/** `not x` of a "none" atom, in words: `assigned`, `has a tag`; null for any other. */
function anyWords(item: FilterExpr): string | null {
  switch (item.kind) {
    case 'person': return item.id === 0 ? 'assigned' : null
    case 'tag': return item.id === 0 ? 'has a tag' : null
    case 'status': return item.id === 0 ? 'has a status' : null
    case 'priority': return item.value === 'none' ? 'has a priority' : null
    default: return null
  }
}

/** An `or`'s item, a date range and its type's none folded into one. */
type OrItem = FilterExpr | { kind: 'dateOrNone'; field: DateField; match: DateMatch }

/** An `or`'s items with each date range and the same type's none (`… or never followed`) as one item, at the range's place. */
function foldNoDate(items: readonly FilterExpr[]): OrItem[] {
  const partner = new Map<number, number>()
  const taken = new Set<number>()
  items.forEach((item, i) => {
    if (item.kind !== 'date' || item.match.match !== 'range' || !dateTypeIsOptional(item.field)) return
    const j = items.findIndex((o, k) => !taken.has(k) && o.kind === 'date' && o.field === item.field && o.match.match === 'unset')
    if (j < 0) return
    partner.set(i, j)
    taken.add(j)
  })
  return items.flatMap((item, i): OrItem[] => {
    if (taken.has(i)) return []
    if (partner.has(i) && item.kind === 'date') return [{ kind: 'dateOrNone', field: item.field, match: item.match }]
    return [item]
  })
}

class Reader {
  readonly pieces: WordPiece[] = []
  term = 0

  constructor(private readonly names: ExpressionNames) {}

  private push(kind: 'word' | 'joiner', text: string) {
    this.pieces.push({ kind, text, term: this.term })
  }

  private name(name: WordNameKind, text: string) {
    this.pieces.push({ kind: 'name', name, text, term: this.term })
  }

  atom(e: FilterExpr) {
    switch (e.kind) {
      case 'person':
        if (e.id === 0) this.push('word', 'unassigned')
        else this.name('person', this.names.person(e.id) ?? GONE.person)
        return
      case 'tag':
        if (e.id === 0) this.push('word', 'no tags')
        else this.name('tag', `#${this.names.tag(e.id) ?? GONE.tag}`)
        return
      case 'status':
        if (e.id === 0) this.push('word', 'no status')
        else this.name('status', this.names.status(e.id) ?? GONE.status)
        return
      case 'priority':
        if (e.value === 'none') this.push('word', 'no priority')
        else this.name('priority', MARKER_LABELS[e.value])
        return
      case 'text':
        this.push('word', `mentions “${e.text}”`)
        return
      case 'date':
        this.push('word', dateWords(e.field, e.match))
        return
      case 'and':
        this.push('joiner', '(')
        this.nestedAnd(e.items)
        this.push('joiner', ')')
        return
      case 'or':
        this.orGroup(e.items, true, false)
        return
      case 'not':
        this.not(e.item)
        return
    }
  }

  /** `not x`: an "any" in words, else `not` and its operand. */
  not(item: FilterExpr) {
    const any = anyWords(item)
    if (any) {
      this.push('word', any)
      return
    }
    this.push('joiner', 'not')
    this.atom(item)
  }

  /** An `or`'s items: `, or` between them at the top level, else ` or ` in brackets. */
  orGroup(items: readonly FilterExpr[], bracketed: boolean, comma: boolean) {
    const folded = foldNoDate(items)
    const only = folded.length === 1 ? folded[0] : undefined
    if (only) {
      this.orItem(only)
      return
    }
    if (bracketed) this.push('joiner', '(')
    folded.forEach((item, i) => {
      if (i > 0) {
        if (comma) this.push('joiner', ',')
        this.push('joiner', 'or')
      }
      this.orItem(item)
    })
    if (bracketed) this.push('joiner', ')')
  }

  private orItem(item: OrItem) {
    if (item.kind === 'dateOrNone') this.push('word', dateWords(item.field, item.match, true))
    else if (item.kind === 'and') this.nestedAnd(item.items)
    else this.atom(item)
  }

  /**
   * An `and` inside an `or`: its terms joined by `and`, the `not` ones last
   * after `but not` (several joined by `or`); only `not` terms: `not a and
   * not b`.
   */
  nestedAnd(items: readonly FilterExpr[]) {
    const isNegative = (e: FilterExpr) => e.kind === 'not' && anyWords(e.item) == null
    const positives = items.filter((e) => !isNegative(e))
    const negatives = items.flatMap((e) => (e.kind === 'not' && isNegative(e) ? [e.item] : []))
    if (positives.length === 0) {
      negatives.forEach((item, i) => {
        if (i > 0) this.push('joiner', 'and')
        this.not(item)
      })
      return
    }
    positives.forEach((item, i) => {
      if (i > 0) this.push('joiner', 'and')
      this.atom(item)
    })
    negatives.forEach((item, i) => {
      this.push('joiner', i === 0 ? 'but not' : 'or')
      this.atom(item)
    })
  }

  /** The whole expression (normalized). */
  root(e: FilterExpr): number {
    if (e.kind === 'and') {
      e.items.forEach((item, i) => {
        this.term = i
        if (i > 0) this.push('joiner', '·')
        this.atom(item)
      })
      return e.items.length
    }
    if (e.kind === 'or') this.orGroup(e.items, false, true)
    else this.atom(e)
    return 1
  }
}

/** Whether a space goes between two pieces (none after `(`, none before `)` or `,`). */
function spaced(prev: WordPiece, next: WordPiece): boolean {
  if (prev.kind === 'joiner' && prev.text === '(') return false
  return !(next.kind === 'joiner' && (next.text === ')' || next.text === ','))
}

/** The space before each piece: `''` for the first and where none goes (`spaced`). */
export function pieceSpaces(pieces: readonly WordPiece[]): string[] {
  return pieces.map((p, i) => {
    const prev = i > 0 ? pieces[i - 1] : undefined
    return prev && spaced(prev, p) ? ' ' : ''
  })
}

/** The pieces as plain text. */
export function wordsText(pieces: readonly WordPiece[]): string {
  const spaces = pieceSpaces(pieces)
  return pieces.map((p, i) => `${spaces[i] ?? ''}${p.text}`).join('')
}

/** An expression in words (see the module comment). */
export function expressionWords(expression: FilterExpr, names: ExpressionNames): ExpressionWords {
  const reader = new Reader(names)
  const terms = reader.root(normalizeExpression(expression))
  const pieces = reader.pieces
  const first = pieces[0]
  if (first?.kind === 'word') pieces[0] = { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) }
  return { pieces, terms, text: wordsText(pieces) }
}
