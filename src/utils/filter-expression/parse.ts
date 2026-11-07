import type { DateField } from '../../models/app-view'
import type { DateAnchor, DateMatch, MarkerKey } from '../../models/filter-predicate'
import { EXPRESSION_DEPTH_MAX, EXPRESSION_NODES_MAX, EXPRESSION_TEXT_MAX, type FilterExpr, type IdAtomKind } from '../../models/filter-expression'
import { PREDICATE_SEARCH_TEXT_MAX } from '../../models/filter-predicate'
import { parseDatePhrase, parseNumericDate } from '../date-phrase'
import {
  BEFORE_TODAY,
  DATE_WORD,
  DATE_WORDS,
  PERIOD_WORDS,
  dateTypeIsOptional,
  dayAnchor,
  fixedAnchorOf,
  periodRange,
  range,
  shiftAnchor,
  tokenOfWords,
  type PeriodWord,
} from './dates'
import { expressionDepth, expressionSize, normalizeExpression } from './tree'

/**
 * The filter expression parser: text → a `FilterExpr` (names resolved to
 * ids), or the first error with where it is. The grammar is the search
 * box's tokens joined by `and` / `or` / `not` and parentheses (`not` binds
 * first, then `and`, then `or`):
 *
 * - `"budget review"` — text the task contains (bare words side by side are
 *   one phrase, read as if quoted; inside quotes nothing is a keyword);
 * - `@Aisha` `@"Aisha Rahman"` · `#q4` `#"R&D"` · `!Waiting` `!"On Hold"` ·
 *   `/urgent` `/important` `/focus`;
 * - `no person|tag|status|priority`, `any person|tag|status|priority`;
 * - a date type (`due`, `followup`, `followed`, `created`, `modified`,
 *   `completed`) with `any` / `none`, a day, a period (`this week`), `before`
 *   / `by` / `after` / `from` a day, `a..b`, `within [last] N days`; `no
 *   due`, `no followup`, `never followed`, `overdue`, `followup late`;
 * - `done` — Show completed, only as a term of the top-level `and`.
 *
 * Two terms side by side need an `and` / `or` between them.
 */

export interface ExpressionNameResolver {
  person: (name: string) => number | undefined
  tag: (name: string) => number | undefined
  status: (name: string) => number | undefined
}

export interface ExpressionParseOptions {
  /** Today, for the day words that are fixed dates (`fri`, `11/30`). */
  today: Date
  names: ExpressionNameResolver
  /** `false`: `@` terms are refused (the check-in filter: a check-in goes to one person). */
  allowPeople?: boolean
}

/** What a span of the text is, for tinting. */
export type ExpressionSpanKind =
  | 'operator' | 'paren' | 'person' | 'tag' | 'status'
  | 'urgent' | 'important' | 'focus' | 'priority'
  | 'due' | 'followup' | 'date' | 'text' | 'done' | 'none'

export interface ExpressionSpan {
  start: number
  end: number
  kind: ExpressionSpanKind
}

export interface ExpressionError {
  start: number
  end: number
  message: string
  /** More about it (the error's tooltip). */
  hint?: string
}

export type ExpressionParse =
  | { ok: true; expression: FilterExpr | null; showCompleted: boolean; spans: ExpressionSpan[] }
  | { ok: false; error: ExpressionError; spans: ExpressionSpan[] }

// ── Tokens ──────────────────────────────────────────────────────────────────

type LexKind = 'lparen' | 'rparen' | 'quoted' | 'name' | 'slash' | 'word' | 'dotdot'

interface Lex {
  kind: LexKind
  start: number
  end: number
  /** A word as typed; a quoted text or a name without its quotes; a slash word without the slash. */
  value: string
  sigil?: '@' | '#' | '!'
  /** A quote that never closes. */
  open?: true
}

const MENTION_CHAR = /[\p{L}\p{M}\p{N}_]/u
const TAG_CHAR = /[A-Za-z0-9_-]/
const isSpace = (ch: string) => /\s/.test(ch)

function lex(text: string): Lex[] {
  const out: Lex[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text.charAt(i)
    if (isSpace(ch)) { i++; continue }
    if (ch === '(' || ch === ')') {
      out.push({ kind: ch === '(' ? 'lparen' : 'rparen', start: i, end: i + 1, value: ch })
      i++
      continue
    }
    if (ch === '.' && text.charAt(i + 1) === '.') {
      out.push({ kind: 'dotdot', start: i, end: i + 2, value: '..' })
      i += 2
      continue
    }
    if (ch === '"') {
      const close = text.indexOf('"', i + 1)
      if (close < 0) {
        out.push({ kind: 'quoted', start: i, end: n, value: text.slice(i + 1), open: true })
        i = n
      } else {
        out.push({ kind: 'quoted', start: i, end: close + 1, value: text.slice(i + 1, close) })
        i = close + 1
      }
      continue
    }
    if (ch === '@' || ch === '#' || ch === '!') {
      const start = i
      i++
      if (text.charAt(i) === '"') {
        const close = text.indexOf('"', i + 1)
        if (close < 0) {
          out.push({ kind: 'name', sigil: ch, start, end: n, value: text.slice(i + 1), open: true })
          i = n
        } else {
          out.push({ kind: 'name', sigil: ch, start, end: close + 1, value: text.slice(i + 1, close) })
          i = close + 1
        }
        continue
      }
      const allowed = ch === '#' ? TAG_CHAR : MENTION_CHAR
      while (i < n && allowed.test(text.charAt(i))) i++
      out.push({ kind: 'name', sigil: ch, start, end: i, value: text.slice(start + 1, i) })
      continue
    }
    const start = i
    while (i < n) {
      const c = text.charAt(i)
      if (isSpace(c) || c === '(' || c === ')' || c === '"' || (c === '.' && text.charAt(i + 1) === '.')) break
      i++
    }
    const raw = text.slice(start, i)
    if (raw.startsWith('/')) out.push({ kind: 'slash', start, end: i, value: raw.slice(1) })
    else out.push({ kind: 'word', start, end: i, value: raw })
  }
  return out
}

// ── Parser ──────────────────────────────────────────────────────────────────

/** Words that end a text phrase: they start a term or join terms. */
const KEYWORDS = new Set(['and', 'or', 'not', 'no', 'any', 'never', 'overdue', 'done', ...DATE_WORDS.keys()])

const PRIORITIES: ReadonlyMap<string, MarkerKey> = new Map([['urgent', 'urgent'], ['important', 'important'], ['focus', 'focus']])

const ENTITY_KINDS: ReadonlyMap<string, IdAtomKind> = new Map([
  ['person', 'person'], ['people', 'person'], ['tag', 'tag'], ['tags', 'tag'], ['status', 'status'],
])

const SIGIL_KIND: Record<'@' | '#' | '!', IdAtomKind> = { '@': 'person', '#': 'tag', '!': 'status' }
const KIND_NOUN: Record<IdAtomKind, string> = { person: 'person', tag: 'tag', status: 'status' }

const DAY_HINT = 'Try today, fri, 11/30, in 3 days, 3 days ago'
const WHEN_HINT = 'Try any, none, today, this week, by fri, within 3 days, 11/1..11/30'

/** A `done` term while parsing: it becomes Show completed (top level only). */
interface DoneNode { kind: 'done'; start: number; end: number }
type Node = FilterExpr | DoneNode

class ParseFailure extends Error {
  constructor(readonly error: ExpressionError) {
    super(error.message)
  }
}

function fail(start: number, end: number, message: string, hint?: string): never {
  throw new ParseFailure(hint ? { start, end, message, hint } : { start, end, message })
}

const lower = (t: Lex | undefined) => (t?.kind === 'word' ? t.value.toLowerCase() : null)

class Parser {
  private pos = 0
  readonly spans: ExpressionSpan[] = []

  constructor(private readonly tokens: Lex[], private readonly opts: ExpressionParseOptions, private readonly length: number) {}

  private peek(offset = 0): Lex | undefined {
    return this.tokens[this.pos + offset]
  }

  private next(): Lex | undefined {
    const t = this.tokens[this.pos]
    if (t) this.pos++
    return t
  }

  private span(t: { start: number; end: number }, kind: ExpressionSpanKind): void {
    this.spans.push({ start: t.start, end: t.end, kind })
  }

  private isWord(word: string, offset = 0): boolean {
    return lower(this.peek(offset)) === word
  }

  parseAll(): Node | null {
    if (this.tokens.length === 0) return null
    const node = this.parseOr()
    const extra = this.peek()
    if (extra) {
      if (extra.kind === 'rparen') fail(extra.start, extra.end, 'No ( for this )')
      fail(extra.start, extra.end, `Add and / or before “${this.tokenText(extra)}”`)
    }
    return node
  }

  private tokenText(t: Lex): string {
    if (t.kind === 'quoted') return `"${t.value}"`
    if (t.kind === 'name') return `${t.sigil ?? ''}${t.value}`
    if (t.kind === 'slash') return `/${t.value}`
    return t.value
  }

  private parseOr(): Node {
    const items = [this.parseAnd()]
    while (this.isWord('or')) {
      const op = this.next()
      if (op) this.span(op, 'operator')
      items.push(this.parseAnd(op))
    }
    return items.length === 1 ? (items[0] as Node) : { kind: 'or', items: items as FilterExpr[] }
  }

  private parseAnd(after?: Lex): Node {
    const items = [this.parseUnary(after)]
    for (;;) {
      if (this.isWord('and')) {
        const op = this.next()
        if (op) this.span(op, 'operator')
        items.push(this.parseUnary(op))
        continue
      }
      const t = this.peek()
      if (!t || t.kind === 'rparen' || this.isWord('or')) break
      fail(t.start, t.end, `Add and / or before “${this.tokenText(t)}”`)
    }
    return items.length === 1 ? (items[0] as Node) : { kind: 'and', items: items as FilterExpr[] }
  }

  private parseUnary(after?: Lex): Node {
    if (this.isWord('not')) {
      const op = this.next()
      if (op) this.span(op, 'operator')
      const item = this.parseUnary(op)
      if (item.kind === 'done') fail(item.start, item.end, 'done goes at the top level', 'Add “and done” to show completed tasks too')
      return { kind: 'not', item }
    }
    return this.parsePrimary(after)
  }

  private parsePrimary(after?: Lex): Node {
    const t = this.next()
    if (!t) {
      if (after) fail(after.start, after.end, `“${after.value}” needs something after it`)
      fail(this.length, this.length, 'Something is missing here')
    }
    switch (t.kind) {
      case 'lparen': {
        this.span(t, 'paren')
        if (this.peek()?.kind === 'rparen') {
          const close = this.next()
          fail(t.start, close?.end ?? t.end, 'Nothing between ( and )')
        }
        const inner = this.parseOr()
        const close = this.next()
        if (close?.kind !== 'rparen') fail(t.start, t.end, 'Missing )', 'Close the ( that starts here')
        this.span(close, 'paren')
        if (inner.kind === 'done') fail(inner.start, inner.end, 'done goes at the top level', 'Add “and done” to show completed tasks too')
        return inner
      }
      case 'rparen': return fail(t.start, t.end, 'No ( for this )')
      case 'dotdot': return fail(t.start, t.end, '.. goes between two days', 'As in due 11/1..11/30')
      case 'quoted': return this.text(t)
      case 'name': return this.entity(t)
      case 'slash': return this.priority(t)
      case 'word': return this.word(t)
    }
  }

  private text(t: Lex): FilterExpr {
    if (t.open) fail(t.start, t.end, 'Missing closing "')
    const text = t.value.trim()
    if (!text) fail(t.start, t.end, 'Nothing between the quotes')
    if (text.length > PREDICATE_SEARCH_TEXT_MAX) fail(t.start, t.end, 'This text is too long')
    this.span(t, 'text')
    return { kind: 'text', text }
  }

  private entity(t: Lex): FilterExpr {
    const kind = SIGIL_KIND[t.sigil ?? '@']
    if (t.open) fail(t.start, t.end, 'Missing closing "')
    const name = t.value.trim()
    if (!name) fail(t.start, t.end, `Pick a ${KIND_NOUN[kind]} after ${t.sigil ?? '@'}`)
    if (kind === 'person' && this.opts.allowPeople === false) {
      fail(t.start, t.end, 'Leave people out', 'A check-in already goes to one person')
    }
    const id = this.opts.names[kind](name)
    if (id == null) fail(t.start, t.end, `No ${KIND_NOUN[kind]} named ${name}`)
    this.span(t, kind)
    return { kind, id }
  }

  private priority(t: Lex): FilterExpr {
    const key = PRIORITIES.get(t.value.toLowerCase())
    if (!key) fail(t.start, t.end, `Unknown /${t.value}`, 'Use /urgent, /important or /focus')
    this.span(t, key)
    return { kind: 'priority', value: key }
  }

  private word(t: Lex): Node {
    const w = t.value.toLowerCase()
    if (w === 'and' || w === 'or') fail(t.start, t.end, `“${w}” needs something before it`)
    if (w === 'done') {
      this.span(t, 'done')
      return { kind: 'done', start: t.start, end: t.end }
    }
    if (w === 'overdue') {
      this.span(t, 'due')
      return { kind: 'date', field: 'deadline', match: BEFORE_TODAY }
    }
    if (w === 'no') return this.noTerm(t)
    if (w === 'any') return this.anyTerm(t)
    if (w === 'never') {
      const followed = this.peek()
      if (lower(followed) !== 'followed' || !followed) fail(t.start, t.end, 'never what?', 'never followed: never followed up')
      this.next()
      this.span({ start: t.start, end: followed.end }, 'followup')
      return { kind: 'date', field: 'lastFollowup', match: { match: 'unset' } }
    }
    const field = DATE_WORDS.get(w)
    if (field) return this.dateTerm(t, field)
    return this.phrase(t)
  }

  /** Bare words side by side, up to a keyword or another kind of token: one text phrase. */
  private phrase(first: Lex): FilterExpr {
    const words = [first.value]
    let end = first.end
    for (;;) {
      const t = this.peek()
      if (t?.kind !== 'word' || KEYWORDS.has(t.value.toLowerCase())) break
      words.push(t.value)
      end = t.end
      this.next()
    }
    const text = words.join(' ')
    if (text.length > PREDICATE_SEARCH_TEXT_MAX) fail(first.start, end, 'This text is too long')
    this.span({ start: first.start, end }, 'text')
    return { kind: 'text', text }
  }

  private noTerm(t: Lex): FilterExpr {
    const what = this.peek()
    const w = lower(what)
    const kind = w ? ENTITY_KINDS.get(w) : undefined
    if (what && kind) {
      this.next()
      this.span({ start: t.start, end: what.end }, 'none')
      return { kind, id: 0 }
    }
    if (what && w === 'priority') {
      this.next()
      this.span({ start: t.start, end: what.end }, 'none')
      return { kind: 'priority', value: 'none' }
    }
    const field = w ? DATE_WORDS.get(w) : undefined
    if (what && field) {
      if (field === 'lastFollowup') fail(t.start, what.end, 'Say never followed')
      if (field === 'completed') fail(t.start, what.end, 'Open tasks show unless you add “and done”')
      if (!dateTypeIsOptional(field)) fail(t.start, what.end, `Every task has a ${DATE_WORD[field]} date`)
      this.next()
      this.span({ start: t.start, end: what.end }, field === 'deadline' ? 'due' : 'followup')
      return { kind: 'date', field, match: { match: 'unset' } }
    }
    fail(t.start, what?.end ?? t.end, 'no what?', 'no person, no tag, no status, no priority, no due, no followup')
  }

  private anyTerm(t: Lex): FilterExpr {
    const what = this.peek()
    const w = lower(what)
    const kind = w ? ENTITY_KINDS.get(w) : undefined
    if (what && kind) {
      this.next()
      this.span({ start: t.start, end: what.end }, 'none')
      return { kind: 'not', item: { kind, id: 0 } }
    }
    if (what && w === 'priority') {
      this.next()
      this.span({ start: t.start, end: what.end }, 'none')
      return { kind: 'not', item: { kind: 'priority', value: 'none' } }
    }
    fail(t.start, what?.end ?? t.end, 'any what?', 'any person, any tag, any status, any priority — for a date: due any')
  }

  private dateTerm(t: Lex, field: DateField): FilterExpr {
    const kind: ExpressionSpanKind = field === 'deadline' ? 'due' : field === 'followup' || field === 'lastFollowup' ? 'followup' : 'date'
    const startPos = this.pos
    const match = this.when(t, field)
    const last = this.tokens[this.pos - 1]
    this.span({ start: t.start, end: this.pos > startPos && last ? last.end : t.end }, kind)
    return { kind: 'date', field, match }
  }

  /** What follows a date type's word. */
  private when(dateWord: Lex, field: DateField): DateMatch {
    const t = this.peek()
    const w = lower(t)
    if (!t || !w) fail(dateWord.start, dateWord.end, `${dateWord.value} when?`, WHEN_HINT)
    if (w === 'any' || w === 'none') {
      if (!dateTypeIsOptional(field)) {
        fail(dateWord.start, t.end, field === 'completed' ? 'completed takes a date' : `Every task has a ${DATE_WORD[field]} date`,
          field === 'completed' ? 'completed this week; add “and done” to show completed tasks' : undefined)
      }
      this.next()
      return { match: w === 'any' ? 'set' : 'unset' }
    }
    if (w === 'late') {
      if (field !== 'followup') fail(t.start, t.end, 'late goes with followup', 'followup late')
      this.next()
      return BEFORE_TODAY
    }
    if (w === 'before' || w === 'by' || w === 'after' || w === 'from') {
      this.next()
      const day = this.day()
      if (w === 'by') return range(null, day.anchor)
      if (w === 'from') return range(day.anchor, null)
      const moved = shiftAnchor(day.anchor, w === 'before' ? -1 : 1)
      if (!moved) fail(day.start, day.end, `Use ${w === 'before' ? 'by' : 'from'} with a week or month`, `${w === 'before' ? 'by' : 'from'} includes the day`)
      return w === 'before' ? range(null, moved) : range(moved, null)
    }
    if (w === 'within') {
      this.next()
      let back = false
      if (this.isWord('last')) { back = true; this.next() } else if (this.isWord('next')) this.next()
      const num = this.next()
      const days = num?.kind === 'word' ? countOf(num.value) : null
      if (days == null || !num) fail(t.start, num?.end ?? t.end, 'within how many days?', 'within 3 days, within last 7 days')
      const unit = this.next()
      if (lower(unit) !== 'day' && lower(unit) !== 'days') fail(num.start, unit?.end ?? num.end, 'within N days', 'within 3 days, within last 7 days')
      return back ? range(dayAnchor(-days), dayAnchor(0)) : range(dayAnchor(0), dayAnchor(days))
    }
    const second = lower(this.peek(1))
    const period = `${w} ${second ?? ''}` as PeriodWord
    if (second && PERIOD_WORDS.includes(period)) {
      this.next()
      this.next()
      return periodRange(period, field)
    }
    const from = this.day()
    if (this.peek()?.kind === 'dotdot') {
      this.next()
      const to = this.day()
      return range(from.anchor, to.anchor)
    }
    return range(from.anchor, from.anchor)
  }

  /** One day: `today`, `fri`, `next fri`, `in 3 days`, `3 days ago`, `11/30`, `start of next week`, `end of month + 3`. */
  private day(): { anchor: DateAnchor; start: number; end: number } {
    const t = this.next()
    if (!t) fail(this.length, this.length, 'A day goes here', DAY_HINT)
    if (t.kind !== 'word') fail(t.start, t.end, `Can't read “${this.tokenText(t)}” as a day`, DAY_HINT)
    const w = t.value.toLowerCase()
    const done = (anchor: DateAnchor, end = t.end) => ({ anchor, start: t.start, end })
    if (w === 'today') return done(dayAnchor(0))
    if (w === 'tomorrow' || w === 'tmr') return done(dayAnchor(1))
    if (w === 'yesterday') return done(dayAnchor(-1))
    if (w === 'in') {
      const num = this.next()
      const days = num?.kind === 'word' ? countOf(num.value) : null
      const unit = this.next()
      if (days == null || !num || (lower(unit) !== 'day' && lower(unit) !== 'days') || !unit) fail(t.start, unit?.end ?? num?.end ?? t.end, 'in how many days?', 'in 3 days')
      return done(dayAnchor(days), unit.end)
    }
    const count = countOf(w)
    if (count != null) {
      const unit = this.next()
      const ago = this.next()
      if ((lower(unit) !== 'day' && lower(unit) !== 'days') || lower(ago) !== 'ago' || !ago) {
        fail(t.start, ago?.end ?? unit?.end ?? t.end, `Can't read “${w}” as a day`, '3 days ago, in 3 days')
      }
      return done(dayAnchor(-count), ago.end)
    }
    if (w === 'start' || w === 'end') {
      const words = [w]
      let end = t.end
      while (words.length < 6) {
        const nx = this.peek()
        const lw = lower(nx)
        if (!nx || !lw || !['of', 'next', 'last', 'week', 'month', '+', '3'].includes(lw)) break
        words.push(lw)
        end = nx.end
        this.next()
        if (lw === 'week' || (lw === 'month' && !(this.isWord('+') && this.isWord('3', 1)))) break
      }
      const token = tokenOfWords(words.join(' '))
      if (!token) fail(t.start, end, `Can't read “${words.join(' ')}”`, 'start of week, end of next month')
      return done({ kind: 'relative', token }, end)
    }
    if (w === 'next') {
      const day = this.next()
      const date = day?.kind === 'word' ? parseDatePhrase(`next ${day.value}`, this.opts.today) : null
      if (!date || !day) fail(t.start, day?.end ?? t.end, 'next what?', 'next fri; next week goes after a date type')
      return done(fixedAnchorOf(date), day.end)
    }
    // A year-less date is this year's (a filter looks back as often as ahead); the printer writes the year.
    const date = /^\d{1,2}\/\d{1,2}$/.test(w)
      ? parseNumericDate(`${w}/${this.opts.today.getFullYear()}`, this.opts.today)
      : parseDatePhrase(w, this.opts.today)
    if (!date) fail(t.start, t.end, `Can't read “${t.value}”`, DAY_HINT)
    return done(fixedAnchorOf(date))
  }
}

/** A whole count of days (`3`), or null. */
function countOf(word: string): number | null {
  if (!/^\d{1,4}$/.test(word)) return null
  const n = parseInt(word, 10)
  return n <= 3660 ? n : null
}

/** Where `done` stands: only as the root or a term of the root's `and`. */
function liftDone(root: Node | null): { expression: FilterExpr | null; showCompleted: boolean } {
  if (root == null) return { expression: null, showCompleted: false }
  if (root.kind === 'done') return { expression: null, showCompleted: true }
  if (root.kind !== 'and') {
    assertNoDone(root)
    return { expression: root, showCompleted: false }
  }
  const items = root.items as Node[]
  const rest = items.filter((i) => i.kind !== 'done') as FilterExpr[]
  for (const item of rest) assertNoDone(item)
  const showCompleted = rest.length < items.length
  const expression: FilterExpr | null = rest.length === 0 ? null : rest.length === 1 ? (rest[0] ?? null) : { kind: 'and', items: rest }
  return { expression, showCompleted }
}

function assertNoDone(node: Node): void {
  if (node.kind === 'done') fail(node.start, node.end, 'done goes at the top level', 'Add “and done” to show completed tasks too')
  if (node.kind === 'and' || node.kind === 'or') for (const item of node.items as Node[]) assertNoDone(item)
  if (node.kind === 'not') assertNoDone(node.item as Node)
}

/** Parses a filter expression (see the module comment). */
export function parseExpression(text: string, opts: ExpressionParseOptions): ExpressionParse {
  if (text.length > EXPRESSION_TEXT_MAX) {
    return { ok: false, error: { start: 0, end: text.length, message: 'This expression is too long' }, spans: [] }
  }
  const parser = new Parser(lex(text), opts, text.length)
  try {
    const { expression, showCompleted } = liftDone(parser.parseAll())
    const normalized = expression && normalizeExpression(expression)
    if (normalized && (expressionSize(normalized) > EXPRESSION_NODES_MAX || expressionDepth(normalized) > EXPRESSION_DEPTH_MAX)) {
      return { ok: false, error: { start: 0, end: text.length, message: 'This expression is too long' }, spans: parser.spans }
    }
    return { ok: true, expression: normalized, showCompleted, spans: sortedSpans(parser.spans) }
  } catch (e) {
    if (e instanceof ParseFailure) return { ok: false, error: e.error, spans: sortedSpans(parser.spans) }
    throw e
  }
}

function sortedSpans(spans: ExpressionSpan[]): ExpressionSpan[] {
  return [...spans].sort((a, b) => a.start - b.start)
}
