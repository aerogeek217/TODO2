import type { DateAnchor, DateMatch, MarkerKey, Person, RelativeDateToken, Status, Tag } from '../models'
import { parseDatePhrase } from '../utils/date-phrase'
import { fixedAnchor } from '../utils/filter-criteria'
import type { SearchClause } from '../utils/search-clause'
import { collapseWhitespace } from '../utils/text'
import { parseInput, type ParsedToken } from './natural-language-parser'
import { matchPerson, matchStatus, matchTag } from './nlp-resolver'
import { removeTextSpans, type TextEdit } from './nlp-chip-edit'
import {
  computeAutocomplete,
  type AutocompleteItem,
  type AutocompleteRow,
  type AutocompleteSources,
  type AutocompleteView,
} from './nlp-autocomplete'
import { COMMAND_SHAPE, lookupSlashCommand, parseCommandDate } from './slash-commands'
import type { TintSpan, TokenTint } from './nlp-token-tints'

/**
 * The search box's grammar (D16): what typed into the top bar's search (or
 * the phone sheet's) becomes a screen-filter chip. A pass over Quick Add's
 * parser (`parseInput`) — its `@person`, `#tag` and `/command` tokens — that
 * also reads search words:
 *
 *  - `@name` → People, `#name` → Tags (several of a kind OR, as the pickers);
 *    a name matching nobody stays words (a search never creates);
 *  - `/status ⟨name⟩`, or a status's own name as a command (`/waiting`);
 *  - `/urgent` `/important` `/focus` → Priority, `/hot` → Hot;
 *  - `overdue` → Due before today;
 *  - `due ⟨phrase⟩` / `followup ⟨phrase⟩`: today · tomorrow · ⟨weekday⟩ ·
 *    MM/DD (`utils/date-phrase`) · this week · next week · this month, and
 *    `followup late`; `/due` / `/followup ⟨date⟩` read as one day too;
 *  - `no due`, `no followup` → that date type's No date;
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

/** An `@` / `#` token the box keeps as words: no such person / tag (`unmatched`), or Esc on its popup. */
export interface SearchName {
  kind: 'person' | 'tag'
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
  /** Commands that can't be read (`/due frday`, `/status nope`): tinted, kept as words. */
  errors: { start: number; end: number }[]
}

/** A token kept as words (Esc on its popup): where it starts, as typed. */
export interface KeptToken { start: number; raw: string }

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

/** The `/status` argument a repeated `/status …` names (`/status "In progress"` → `In progress`). */
function statusArgument(raw: string): string {
  return raw.replace(/^\/status\s+/i, '').trim().replace(/^"(.*)"$/, '$1').trim()
}

/**
 * The tokens and kept names of `text`. `kept`: `@` / `#` tokens Esc kept as
 * words (matched by where they start and their text).
 */
export function parseSearch(text: string, sources: SearchSources, kept: readonly KeptToken[] = []): SearchParse {
  const { people, tags, statuses, today } = sources
  const parsed = parseInput(text, today)
  const tokens: SearchToken[] = []
  const names: SearchName[] = []
  const errors: { start: number; end: number }[] = []
  const complete = (end: number) => isSpace(parsed.text[end])
  const push = (span: { raw: string; start: number; end: number }, clause: SearchClause) => {
    tokens.push({ raw: span.raw, start: span.start, end: span.end, clause, complete: complete(span.end) })
  }
  const status = (span: { raw: string; start: number; end: number }, name: string) => {
    const s = matchStatus(name, statuses)
    if (s?.id !== undefined) push(span, { field: 'statusIds', id: s.id })
    else errors.push({ start: span.start, end: span.end })
  }
  const name = (t: ParsedToken, kind: 'person' | 'tag') => {
    const isKept = kept.some((k) => k.start === t.start && k.raw === t.raw)
    const id = isKept ? undefined : (kind === 'person' ? matchPerson(t.value, people) : matchTag(t.value, tags))?.id
    if (id !== undefined) push(t, { field: kind === 'person' ? 'personIds' : 'tags', id })
    else names.push({ kind, name: t.value, start: t.start, end: t.end, unmatched: !isKept, complete: complete(t.end) })
  }

  for (const t of parsed.tokens) {
    if (t.type === 'person' || t.type === 'tag') { name(t, t.type); continue }
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
      case 'status':
        status(t, t.value)
        break
      default:
        break // `/repeat`: nothing to filter by; stays words
    }
  }
  for (const p of parsed.problems) {
    if (p.kind === 'unknown') {
      // `/hot`, or a status by its own name (`/waiting`: only a status named so).
      const word = p.raw.slice(1)
      if (word.toLowerCase() === 'hot') { push(p, { field: 'markers', marker: 'hot' }); continue }
      const s = statuses.find((x) => x.name.trim().toLowerCase() === word.toLowerCase())
      if (s?.id !== undefined) push(p, { field: 'statusIds', id: s.id })
    } else if (p.kind === 'duplicate' && p.command === 'status') {
      status(p, statusArgument(p.raw))
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

const MARKER_TINT: Record<MarkerKey | 'hot', TokenTint> = { urgent: 'urgent', important: 'followup', focus: 'accent', hot: 'urgent' }

/**
 * The tinted spans of the box (Quick Add's tints): a token by what it sets,
 * an unknown `@` / `#` name with the "new" ring, an unreadable command as an
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
 * token being typed too), an `@` / `#` kept as words read as its name, a
 * lone `@` / `#` / `/` left out.
 */
export function searchWords(parse: SearchParse): string {
  const pieces: { start: number; end: number; text: string }[] = [
    ...parse.tokens.map((t) => ({ start: t.start, end: t.end, text: ' ' })),
    ...parse.names.map((n) => ({ start: n.start, end: n.end, text: ` ${n.name} ` })),
  ].sort((a, b) => b.start - a.start)
  let out = parse.text
  for (const p of pieces) out = out.slice(0, p.start) + p.text + out.slice(p.end)
  return collapseWhitespace(out.split(/\s+/).filter((w) => !/^[@#/]$/.test(w)).join(' '))
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

/** A status name that works as its own command: one word, not a command's (or `hot`). */
function isStatusCommand(name: string): boolean {
  return COMMAND_SHAPE.test(name) && !lookupSlashCommand(name) && name.toLowerCase() !== 'hot'
}

/**
 * Quick Add's `@ # /` popup for the search box: no Create rows (a search
 * never creates), no `/repeat`, plus `/hot` and each one-word status as its
 * own command (`/waiting`). Null when nothing is listed.
 */
export function searchAutocomplete(value: string, cursor: number, sources: AutocompleteSources): AutocompleteView | null {
  const view = computeAutocomplete(value, cursor, { ...sources, commands: true })
  if (view?.mode === 'entity') return { ...view, rows: view.rows.filter((r) => r.kind !== 'create') }
  const slash = value.slice(0, cursor).match(/(^|\s)\/([A-Za-z-]*)$/)
  if (view && view.mode !== 'command') return view
  if (!slash) return view
  const query = slash[2] ?? ''
  const q = query.toLowerCase()
  const anchor = (slash.index ?? 0) + (slash[1]?.length ?? 0)
  const matchLength = q ? q.length + 1 : 0
  const extra: AutocompleteRow[] = [
    ...('hot'.startsWith(q) ? [{ kind: 'value' as const, insert: '/hot', label: '/hot', matchLength, detail: 'Hot tasks' }] : []),
    ...sources.statuses
      .filter((s: AutocompleteItem) => isStatusCommand(s.name) && s.name.toLowerCase().startsWith(q))
      .map((s) => ({ kind: 'value' as const, insert: `/${s.name.toLowerCase()}`, label: `/${s.name.toLowerCase()}`, matchLength, detail: 'Status', status: s })),
  ]
  const commands = (view?.rows ?? []).filter((r) => r.kind !== 'command' || !NOT_IN_SEARCH.has(r.command.name))
  const rows = [...commands, ...extra]
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
