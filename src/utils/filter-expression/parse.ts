import type { DateField } from '../../models/app-view'
import type { DateAnchor, DateMatch, MarkerKey } from '../../models/filter-predicate'
import { EXPRESSION_DEPTH_MAX, EXPRESSION_NODES_MAX, EXPRESSION_TEXT_MAX, type FilterExpr, type IdAtomKind } from '../../models/filter-expression'
import { PREDICATE_SEARCH_TEXT_MAX } from '../../models/filter-predicate'
import { startOfDay } from '../date'
import { parseDatePhrase, parseNumericDate } from '../date-phrase'
import { quoteText, readQuoted } from '../name-tokens'
import {
  BEFORE_TODAY,
  DATE_WORD,
  anchorWords,
  DATE_WORDS,
  PERIOD_WORDS,
  dateTypeIsOptional,
  dayAnchor,
  fixedAnchorOf,
  looksBack,
  periodRange,
  range,
  relativeDayOf,
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
 *   one phrase, read as if quoted; inside quotes nothing is a keyword, and
 *   `\"` is a quote — `utils/name-tokens.readQuoted`, names alike);
 * - `@Aisha` `@"Aisha Rahman"` · `#q4` `#"R&D"` · `!Waiting` `!"On Hold"` ·
 *   `/urgent` `/important` `/focus`;
 * - `no person|tag|status|priority`, `any person|tag|status|priority`;
 * - a date type (`due`, `followup`, `followed`, `created`, `modified`,
 *   `completed`) with `any` / `none`, a day, a period (`this week`), a
 *   comparison with a day (`<` `<=` `>` `>=` `=`: `due <= fri`, `followup >=
 *   +7d`; `<` / `>` step to the day before / after, `= this week` is the
 *   period), `a..b`, `within [last] N days`; `no due`, `no followup`, `never
 *   followed`, `overdue`, `followup late`. The older words `before` / `by` /
 *   `after` / `from` a day still read (as `<` / `<=` / `>` / `>=`);
 * - a day: `today`, `tomorrow`, `yesterday`, `+3d` / `-30d` (days from
 *   today), `fri`, `next fri`, `11/30`, `start of next week`, and the older
 *   `in 3 days` / `3 days ago`;
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
  /** Today, for the day words that are fixed dates (`fri`, `11/30`: the next one on Due / Next follow-up, on the others the last weekday and this year's day). */
  today: Date
  names: ExpressionNameResolver
  /** `false`: `@`, `no person` and `any person` are refused (the check-in filter: a check-in goes to one person). */
  allowPeople?: boolean
  /** `false`: Completed dates are refused (the check-in filter: it takes open tasks only). */
  allowCompleted?: boolean
  /** `false`: `done` is refused (a lens, an Eisenhower pane, the check-in: they never show completed tasks by it). */
  allowDone?: boolean
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

type LexKind = 'lparen' | 'rparen' | 'quoted' | 'name' | 'slash' | 'word' | 'dotdot' | 'cmp'

/** A comparison after a date word (`due <= fri`). */
type Comparison = '<' | '<=' | '>' | '>=' | '='

/** The characters a comparison is made of: they end a word (`due<=fri` reads as three tokens). */
const isCmpChar = (ch: string) => ch === '<' || ch === '>' || ch === '='

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
    if (isCmpChar(ch)) {
      // `<=` / `>=` as one; any other run (`==`, `=<`) is its pieces, read as an error where it stands.
      const two = (ch === '<' || ch === '>') && text.charAt(i + 1) === '='
      const len = two ? 2 : 1
      out.push({ kind: 'cmp', start: i, end: i + len, value: text.slice(i, i + len) })
      i += len
      continue
    }
    if (ch === '"') {
      const { value, close } = readQuoted(text, i)
      if (close < 0) {
        out.push({ kind: 'quoted', start: i, end: n, value, open: true })
        i = n
      } else {
        out.push({ kind: 'quoted', start: i, end: close + 1, value })
        i = close + 1
      }
      continue
    }
    if (ch === '@' || ch === '#' || ch === '!') {
      const start = i
      i++
      if (text.charAt(i) === '"') {
        const { value, close } = readQuoted(text, i)
        if (close < 0) {
          out.push({ kind: 'name', sigil: ch, start, end: n, value, open: true })
          i = n
        } else {
          out.push({ kind: 'name', sigil: ch, start, end: close + 1, value })
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
      if (isSpace(c) || c === '(' || c === ')' || c === '"' || isCmpChar(c) || (c === '.' && text.charAt(i + 1) === '.')) break
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

const DAY_HINT = 'Try today, fri, 11/30, +3d (in 3 days), -3d (3 days ago)'
const WHEN_HINT = 'Try any, none, today, this week, <= fri, >= +3d, within 3 days, -3d..+7d'
/** A comparison where no date word is before it. */
const CMP_HINT = 'As in due <= +7d — quote text that has one: "a<b"'

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

/**
 * Deepest `(` / `not` nesting the text may have while it is read: far past
 * `EXPRESSION_DEPTH_MAX` (normal form folds `((x))` and `not not x`), and
 * well inside the call stack, so a long text of `(`s is an error, never a
 * `RangeError`.
 */
const NESTING_MAX = 64

class Parser {
  private pos = 0
  private nesting = 0
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
      if (extra.kind === 'cmp') this.strayComparison(extra)
      fail(extra.start, extra.end, `Add and / or before “${this.tokenText(extra)}”`)
    }
    return node
  }

  private tokenText(t: Lex): string {
    if (t.kind === 'quoted') return quoteText(t.value)
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
      if (t.kind === 'cmp') this.strayComparison(t)
      fail(t.start, t.end, `Add and / or before “${this.tokenText(t)}”`)
    }
    return items.length === 1 ? (items[0] as Node) : { kind: 'and', items: items as FilterExpr[] }
  }

  /** Into one more `(` / `not` (`NESTING_MAX`). */
  private nest(t: Lex): void {
    if (++this.nesting > NESTING_MAX) fail(t.start, t.end, 'This nests too deep', 'Fewer ( and not inside each other')
  }

  private parseUnary(after?: Lex): Node {
    if (this.isWord('not')) {
      const op = this.next()
      if (op) {
        this.span(op, 'operator')
        this.nest(op)
      }
      const item = this.parseUnary(op)
      this.nesting--
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
        this.nest(t)
        const inner = this.parseOr()
        this.nesting--
        const close = this.next()
        if (close?.kind !== 'rparen') fail(t.start, t.end, 'Missing )', 'Close the ( that starts here')
        this.span(close, 'paren')
        if (inner.kind === 'done') fail(inner.start, inner.end, 'done goes at the top level', 'Add “and done” to show completed tasks too')
        return inner
      }
      case 'rparen': return fail(t.start, t.end, 'No ( for this )')
      case 'dotdot': return fail(t.start, t.end, '.. goes between two days', 'As in due 11/1..11/30')
      case 'cmp': return this.strayComparison(t)
      case 'quoted': return this.text(t)
      case 'name': return this.entity(t)
      case 'slash': return this.priority(t)
      case 'word': return this.word(t)
    }
  }

  /** A comparison that doesn't follow a date word. */
  private strayComparison(t: Lex): never {
    fail(t.start, t.end, `${t.value} goes after a date word`, CMP_HINT)
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
    if (kind === 'person') this.refusePeople(t.start, t.end)
    const id = this.opts.names[kind](name)
    if (id == null) fail(t.start, t.end, `No ${KIND_NOUN[kind]} named ${name}`)
    this.span(t, kind)
    return { kind, id }
  }

  /** A people term where the filter can't name people (`allowPeople`). */
  private refusePeople(start: number, end: number): void {
    if (this.opts.allowPeople === false) fail(start, end, 'Leave people out', 'A check-in already goes to one person')
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
      if (this.opts.allowDone === false) fail(t.start, t.end, 'done has no say here', 'This filter never shows completed tasks by it')
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
      if (kind === 'person') this.refusePeople(t.start, what.end)
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
      if (kind === 'person') this.refusePeople(t.start, what.end)
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
    if (field === 'completed' && this.opts.allowCompleted === false) fail(t.start, t.end, 'Leave completed out', 'A check-in takes open tasks only')
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
    if (t?.kind === 'cmp') {
      this.next()
      return this.comparison(t.value as Comparison, t, field)
    }
    // `due != fri`: `!` would start a status name.
    if (t?.kind === 'name' && t.sigil === '!' && t.value === '' && this.peek(1)?.kind === 'cmp' && this.peek(1)?.start === t.end) {
      fail(t.start, this.peek(1)?.end ?? t.end, '!= isn’t a comparison', `not ${DATE_WORD[field]} fri: outside that day (tasks without the date pass)`)
    }
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
    const older = OLDER_COMPARISONS.get(w)
    if (older) {
      this.next()
      return this.comparison(older, t, field)
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
    const fromWord = lower(this.peek())
    const from = this.day(field)
    if (this.peek()?.kind === 'dotdot') {
      this.next()
      const toWord = lower(this.peek())
      const to = this.day(field)
      // Two year-less days: one range, read together (`12/20..1/5` runs into the next year).
      if (fromWord && toWord && YEARLESS.test(fromWord) && YEARLESS.test(toWord)) {
        const year = this.opts.today.getFullYear()
        const days = yearlessRange(
          parseNumericDate(`${fromWord}/${year}`, this.opts.today),
          parseNumericDate(`${toWord}/${year}`, this.opts.today),
          !looksBack(field),
          startOfDay(this.opts.today),
        )
        if (days) return range(fixedAnchorOf(days.start), fixedAnchorOf(days.end))
      }
      return range(from.anchor, to.anchor)
    }
    return range(from.anchor, from.anchor)
  }

  /**
   * A comparison's day (`op`, typed as `opToken`: `<=`, or the older `by`):
   * `<= d` is the range up to d, `>= d` from d, `= d` that day (or, with a
   * period, the period: `due = this week`), `< d` / `> d` up to the day
   * before / from the day after — a weekday or a date by a day, a week /
   * month anchor onto its neighbour (`< start of week` is `<= end of last
   * week`), refused where that day has no name. A period with `<` `<=` `>`
   * `>=` is refused: on Due `this week` starts today, on Created at the
   * week's start, so "before this week" would mean two things — its start
   * or end anchor says which.
   */
  private comparison(op: Comparison, opToken: Lex, field: DateField): DateMatch {
    const typed = opToken.kind === 'cmp' ? op : opToken.value.toLowerCase()
    const first = lower(this.peek())
    const second = lower(this.peek(1))
    const period = `${first ?? ''} ${second ?? ''}` as PeriodWord
    if (first && second && PERIOD_WORDS.includes(period)) {
      const periodEnd = this.peek(1)?.end ?? opToken.end
      if (op !== '=') {
        const unit = period.replace('this ', '')
        const edge = op === '<' || op === '>=' ? 'start' : 'end'
        fail(opToken.start, periodEnd, `Compare with a day, not ${period}`, `As in ${DATE_WORD[field]} ${typed} ${edge} of ${unit}`)
      }
      this.next()
      this.next()
      return periodRange(period, field)
    }
    const day = this.day(field)
    const dots = this.peek()
    if (dots?.kind === 'dotdot') {
      fail(opToken.start, dots.end, `${typed} takes one day`, `As in ${DATE_WORD[field]} >= -3d — for a range: ${DATE_WORD[field]} -3d..+7d`)
    }
    if (op === '=') return range(day.anchor, day.anchor)
    if (op === '<=') return range(null, day.anchor)
    if (op === '>=') return range(day.anchor, null)
    const moved = shiftAnchor(day.anchor, op === '<' ? -1 : 1)
    if (!moved) {
      const inclusive = opToken.kind === 'cmp' ? `${op}=` : op === '<' ? 'by' : 'from'
      fail(day.start, day.end, `Use ${inclusive} with ${anchorWords(day.anchor)}`,
        `${typed} is the day ${op === '<' ? 'before' : 'after'} it, which has no name here; ${inclusive} includes the day`)
    }
    return op === '<' ? range(null, moved) : range(moved, null)
  }

  /** One day: `today`, `fri`, `next fri`, `+3d`, `-3d`, `in 3 days`, `3 days ago`, `11/30`, `start of next week`, `end of month + 3`. */
  private day(field: DateField): { anchor: DateAnchor; start: number; end: number } {
    const t = this.next()
    if (!t) fail(this.length, this.length, 'A day goes here', DAY_HINT)
    if (t.kind !== 'word') fail(t.start, t.end, `Can't read “${this.tokenText(t)}” as a day`, DAY_HINT)
    const w = t.value.toLowerCase()
    const done = (anchor: DateAnchor, end = t.end) => ({ anchor, start: t.start, end })
    if (w === 'today') return done(dayAnchor(0))
    if (w === 'tomorrow' || w === 'tmr') return done(dayAnchor(1))
    if (w === 'yesterday') return done(dayAnchor(-1))
    const relative = relativeDayOf(w)
    if (relative != null) return done(dayAnchor(relative))
    if (/^[+-]\d+d?$/.test(w)) fail(t.start, t.end, `Can't read “${t.value}” as a day`, 'Days from today with their sign and d: +3d, -30d (up to 3660)')
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
    // A year-less date rolls forward on the dates that look ahead (due, the
    // next follow-up), as the search box reads it; on the others it is this
    // year's. A bare weekday is the next one there, and the last one on the
    // dates that look back (`created fri`). The printer writes the year.
    const back = looksBack(field)
    const weekday = weekdayOf(w)
    const date = YEARLESS.test(w)
      ? parseNumericDate(back ? `${w}/${this.opts.today.getFullYear()}` : w, this.opts.today)
      : back && weekday >= 0 ? lastWeekday(this.opts.today, weekday) : parseDatePhrase(w, this.opts.today)
    if (!date) fail(t.start, t.end, `Can't read “${t.value}”`, DAY_HINT)
    return done(fixedAnchorOf(date))
  }
}

/** The older words for a comparison (`due by fri` is `due <= fri`): they still read, and print as the comparison. */
const OLDER_COMPARISONS: ReadonlyMap<string, Comparison> = new Map([['before', '<'], ['by', '<='], ['after', '>'], ['from', '>=']])

/** A day typed without its year (`11/30`). */
const YEARLESS = /^\d{1,2}\/\d{1,2}$/

/**
 * A range of two year-less days, each this year's (`start`, `end`), as one:
 * an end before its start is the next year's (on the dates that look back,
 * the start the year before); then, on the dates that look ahead, a range
 * already over is next year's, as a single day rolls forward. Null when
 * either isn't a day.
 */
function yearlessRange(start: Date | null, end: Date | null, ahead: boolean, today: Date): { start: Date; end: Date } | null {
  if (!start || !end) return null
  const shift = (d: Date, years: number) => new Date(d.getFullYear() + years, d.getMonth(), d.getDate())
  let s = start
  let e = end
  if (e < s) {
    if (ahead) e = shift(e, 1)
    else s = shift(s, -1)
  }
  if (ahead && e < today) {
    s = shift(s, 1)
    e = shift(e, 1)
  }
  return { start: s, end: e }
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** A weekday's index for its name or 3-letter abbreviation (`fri`, `friday`), else -1 (as `utils/date-phrase` reads them). */
function weekdayOf(word: string): number {
  return WEEKDAYS.findIndex((d) => d === word || d.slice(0, 3) === word)
}

/** The last `weekday` strictly before `today` (never today, as the next one never is). */
function lastWeekday(today: Date, weekday: number): Date {
  let back = today.getDay() - weekday
  if (back <= 0) back += 7
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)
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
