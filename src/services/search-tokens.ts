import type { DateAnchor, DateMatch, MarkerKey, Person, RelativeDateToken, Status, Tag } from '../models'
import { parseDatePhrase } from '../utils/date-phrase'
import { fixedAnchor } from '../utils/filter-criteria'
import type { SearchClause } from '../utils/search-clause'
import { collapseWhitespace } from '../utils/text'
import { parseInput } from './natural-language-parser'
import { matchPerson, matchStatus, matchTag } from './nlp-resolver'
import { removeTextSpans, type TextEdit } from './nlp-chip-edit'
import {
  computeAutocomplete,
  type AutocompleteSources,
  type AutocompleteView,
} from './nlp-autocomplete'
import { parseCommandDate } from './slash-commands'
import type { TintSpan, TokenTint } from './nlp-token-tints'

/**
 * The search box's grammar (D16): what typed into the top bar's search (or
 * the phone sheet's) becomes a screen-filter chip. A pass over Quick Add's
 * parser (`parseInput`) — its `@person`, `#tag`, `!status` and `/command`
 * tokens — that also reads search words:
 *
 *  - `@name` → People, `#name` → Tags, `!name` → Status (several of a kind
 *    OR, as the pickers); a name matching nothing stays words (a search
 *    never creates);
 *  - `/urgent` `/important` `/focus` → Priority (several: any of them);
 *  - `overdue` → Due before today;
 *  - `due ⟨phrase⟩` / `followup ⟨phrase⟩`: today · tomorrow · ⟨weekday⟩ ·
 *    MM/DD (`utils/date-phrase`) · this week · next week · this month, and
 *    `followup late`; `/due` / `/followup ⟨date⟩` read as one day too;
 *  - `no due`, `no followup` → that date type's None (`unset`);
 *  - `done` / `completed` → Show completed.
 *
 * Everything else is the text search. A token is complete once a space
 * follows it (a pick in the popup adds one; ⏎ completes the rest): then the
 * box makes it a chip and keeps only the other words.
 */

export interface SearchSources {
  people: readonly Person[]
  tags: readonly Tag[]
  statuses: readonly Status[]
  today: Date
}

/** A recognised token: the clause it sets, as typed. */
export interface SearchToken {
  raw: string
  start: number
  end: number
  clause: SearchClause
  /** A space follows it: typing has moved past it. */
  complete: boolean
}

/** An `@` / `#` / `!` token the box keeps as words: no such person / tag / status (`unmatched`), or Esc on its popup. */
export interface SearchName {
  kind: 'person' | 'tag' | 'status'
  name: string
  start: number
  end: number
  unmatched: boolean
  complete: boolean
}

export interface SearchParse {
  text: string
  tokens: SearchToken[]
  names: SearchName[]
  /** Commands that can't be read (`/due frday`, `/repeat often`): tinted, kept as words. */
  errors: { start: number; end: number }[]
}

const FOLLOWUP_WORDS = new Set(['followup', 'follow-up'])
const MAX_PHRASE_WORDS = 4

const relative = (token: RelativeDateToken): DateAnchor => ({ kind: 'relative', token })
const range = (start: DateAnchor | null, end: DateAnchor | null): DateMatch => ({ match: 'range', start, end })
const BEFORE_TODAY = range(null, relative('yesterday'))

/** One day as a range: today / tomorrow / yesterday by name (they move with the day), any other a fixed date. */
function dayRange(phrase: string, date: Date): DateMatch {
  const word = collapseWhitespace(phrase.toLowerCase())
  const anchor = word === 'today' ? relative('today')
    : word === 'tomorrow' || word === 'tmr' ? relative('tomorrow')
      : word === 'yesterday' ? relative('yesterday')
        : fixedAnchor(date)
  return range(anchor, anchor)
}

/** What a `due` / `followup` phrase reads as, or null. */
function phraseMatch(phrase: string, field: 'deadline' | 'followup', today: Date): DateMatch | null {
  const lower = collapseWhitespace(phrase.toLowerCase())
  if (lower === 'this week') return range(relative('today'), relative('end-of-week'))
  if (lower === 'next week') return range(relative('start-of-next-week'), relative('end-of-next-week'))
  if (lower === 'this month') return range(relative('today'), relative('end-of-month'))
  if (field === 'followup' && lower === 'late') return BEFORE_TODAY
  const date = parseDatePhrase(lower, today)
  return date ? dayRange(lower, date) : null
}

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch)

const CLAUSE_FIELD = { person: 'personIds', tag: 'tags', status: 'statusIds' } as const

/**
 * The tokens and kept names of `text`. `kept`: `@` / `#` / `!` tokens Esc
 * kept as words (on their popup), as typed (`@ai`), wherever they are. Every
 * `!` counts — the parser's repeats after the first one too (they OR).
 */
export function parseSearch(text: string, sources: SearchSources, kept: readonly string[] = []): SearchParse {
  const { people, tags, statuses, today } = sources
  const parsed = parseInput(text, today)
  const tokens: SearchToken[] = []
  const names: SearchName[] = []
  const errors: { start: number; end: number }[] = []
  const complete = (end: number) => isSpace(parsed.text[end])
  const push = (span: { raw: string; start: number; end: number }, clause: SearchClause) => {
    tokens.push({ raw: span.raw, start: span.start, end: span.end, clause, complete: complete(span.end) })
  }
  const match = (kind: SearchName['kind'], value: string) =>
    kind === 'person' ? matchPerson(value, people) : kind === 'tag' ? matchTag(value, tags) : matchStatus(value, statuses)
  const name = (t: { raw: string; value: string; start: number; end: number }, kind: SearchName['kind']) => {
    const isKept = kept.includes(t.raw)
    const id = isKept ? undefined : match(kind, t.value)?.id
    if (id !== undefined) push(t, { field: CLAUSE_FIELD[kind], id })
    else names.push({ kind, name: t.value, start: t.start, end: t.end, unmatched: !isKept, complete: complete(t.end) })
  }

  for (const t of parsed.tokens) {
    if (t.type !== 'command') { name(t, t.type); continue }
    switch (t.command) {
      case 'urgent':
      case 'important':
      case 'focus':
        push(t, { field: 'markers', marker: t.command satisfies MarkerKey })
        break
      case 'due':
      case 'followup': {
        const field = t.command === 'due' ? 'deadline' : 'followup'
        if (field === 'followup' && t.value.toLowerCase() === 'none') { push(t, { field, match: { match: 'unset' } }); break }
        const date = parseCommandDate(t.value, today)
        if (date) push(t, { field, match: dayRange(t.value, date) })
        break
      }
      default:
        break // `/repeat`: nothing to filter by; stays words
    }
  }
  for (const p of parsed.problems) {
    if (p.kind === 'duplicate' && p.status !== undefined) {
      name({ raw: p.raw, value: p.status, start: p.start, end: p.end }, 'status')
    } else if (p.kind === 'unreadable') {
      errors.push({ start: p.start, end: p.end })
    }
  }

  // The words no parser token or problem owns.
  const owned = [...parsed.tokens, ...parsed.problems]
  const words: { text: string; start: number; end: number }[] = []
  for (const m of parsed.text.matchAll(/\S+/g)) {
    const start = m.index
    const end = start + m[0].length
    if (!owned.some((o) => start < o.end && end > o.start)) words.push({ text: m[0], start, end })
  }
  /** Words `i .. i + n - 1` follow one another with nothing owned between. */
  const run = (i: number, n: number) => {
    for (let k = i; k < i + n - 1; k++) {
      const a = words[k]
      const b = words[k + 1]
      if (!a || !b || /\S/.test(parsed.text.slice(a.end, b.start))) return false
    }
    return words[i + n - 1] !== undefined
  }
  const span = (i: number, n: number) => {
    const first = words[i]
    const last = words[i + n - 1]
    if (!first || !last) return null
    return { raw: parsed.text.slice(first.start, last.end), start: first.start, end: last.end }
  }
  for (let i = 0; i < words.length; i++) {
    const word = (words[i]?.text ?? '').toLowerCase()
    const one = span(i, 1)
    if (!one) continue
    if (word === 'overdue') { push(one, { field: 'deadline', match: BEFORE_TODAY }); continue }
    if (word === 'done' || word === 'completed') { push(one, { field: 'showCompleted' }); continue }
    if (word === 'no' && run(i, 2)) {
      const next = (words[i + 1]?.text ?? '').toLowerCase()
      const field = next === 'due' ? 'deadline' : FOLLOWUP_WORDS.has(next) ? 'followup' : null
      const two = span(i, 2)
      if (field && two) { push(two, { field, match: { match: 'unset' } }); i += 1; continue }
    }
    if (word === 'due' || FOLLOWUP_WORDS.has(word)) {
      const field = word === 'due' ? 'deadline' : 'followup'
      // The longest phrase that reads (`next fri` before `next`).
      for (let n = MAX_PHRASE_WORDS + 1; n > 1; n--) {
        const whole = run(i, n) ? span(i, n) : null
        const head = words[i]
        if (!whole || !head) continue
        const match = phraseMatch(parsed.text.slice(words[i + 1]?.start ?? head.end, whole.end), field, today)
        if (match) { push(whole, { field, match }); i += n - 1; break }
      }
    }
  }
  tokens.sort((a, b) => a.start - b.start)
  names.sort((a, b) => a.start - b.start)
  return { text: parsed.text, tokens, names, errors }
}

const CLAUSE_TINT: Record<SearchClause['field'], TokenTint> = {
  personIds: 'chip',
  tags: 'chip',
  statusIds: 'chip',
  markers: 'urgent',
  deadline: 'due',
  followup: 'followup',
  showCompleted: 'chip',
}

const MARKER_TINT: Record<MarkerKey, TokenTint> = { urgent: 'urgent', important: 'important', focus: 'focus' }

/**
 * The tinted spans of the box (Quick Add's tints): a token by what it sets,
 * an unknown `@` / `#` / `!` name with the "new" ring, an unreadable command as an
 * error. `active`: the token the popup is open on, tinted as being typed.
 */
export function searchTints(parse: SearchParse, active?: { start: number; end: number }): TintSpan[] {
  const spans: TintSpan[] = [
    ...parse.tokens.map((t) => ({
      start: t.start,
      end: t.end,
      tint: t.clause.field === 'markers' ? MARKER_TINT[t.clause.marker] : CLAUSE_TINT[t.clause.field],
    })),
    ...parse.names.filter((n) => n.unmatched).map((n) => ({ start: n.start, end: n.end, tint: 'new' as const })),
    ...parse.errors.map((e) => ({ ...e, tint: 'error' as const })),
  ]
  if (active && active.end > active.start) {
    const kept = spans.filter((s) => s.end <= active.start || s.start >= active.end)
    kept.push({ start: active.start, end: active.end, tint: 'chip' })
    return kept.sort((a, b) => a.start - b.start)
  }
  return spans.sort((a, b) => a.start - b.start)
}

/**
 * The text search the box's words make: the text without its tokens (a
 * token being typed too), an `@` / `#` / `!` kept as words read as its name,
 * a lone `@` / `#` / `!` / `/` left out.
 */
export function searchWords(parse: SearchParse): string {
  const pieces: { start: number; end: number; text: string }[] = [
    ...parse.tokens.map((t) => ({ start: t.start, end: t.end, text: ' ' })),
    ...parse.names.map((n) => ({ start: n.start, end: n.end, text: ` ${n.name} ` })),
  ].sort((a, b) => b.start - a.start)
  let out = parse.text
  for (const p of pieces) out = out.slice(0, p.start) + p.text + out.slice(p.end)
  return collapseWhitespace(out.split(/\s+/).filter((w) => !/^[@#!/]$/.test(w)).join(' '))
}

/**
 * The box once its complete tokens (with `all`, every token — ⏎) became
 * chips: the tokens taken, and the text left with the caret.
 */
export function takeTokens(parse: SearchParse, caret: number, all = false): { taken: SearchToken[] } & TextEdit {
  const taken = parse.tokens.filter((t) => all || t.complete)
  if (taken.length === 0) return { taken, text: parse.text, caret }
  return { taken, ...removeTextSpans(parse.text, taken, caret) }
}

// ─── The popup ──────────────────────────────────────────────────────

/** What a search can't do with a `/` command: repeat (the commands' own list is Quick Add's). */
const NOT_IN_SEARCH = new Set(['repeat'])

/**
 * Quick Add's `@ # ! /` popup for the search box: no Create rows (a search
 * never creates), no `/repeat`. Null when nothing is listed.
 */
export function searchAutocomplete(value: string, cursor: number, sources: AutocompleteSources): AutocompleteView | null {
  const view = computeAutocomplete(value, cursor, { ...sources, commands: true })
  if (view?.mode === 'entity') return { ...view, rows: view.rows.filter((r) => r.kind !== 'create') }
  const slash = value.slice(0, cursor).match(/(^|\s)\/([A-Za-z-]*)$/)
  if (view && view.mode !== 'command') return view
  if (!slash) return view
  const query = slash[2] ?? ''
  const anchor = (slash.index ?? 0) + (slash[1]?.length ?? 0)
  const rows = (view?.rows ?? []).filter((r) => r.kind !== 'command' || !NOT_IN_SEARCH.has(r.command.name))
  if (rows.length === 0) return null
  return {
    trigger: '/',
    mode: 'command',
    header: 'Commands',
    footer: false,
    rows,
    anchor,
    from: anchor,
    to: cursor,
    query,
  }
}
