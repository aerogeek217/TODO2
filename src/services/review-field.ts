import type { FilterExpr } from '../models'
import { EXPRESSION_KEYWORDS } from '../utils/filter-expression'
import { expressionAutocomplete } from './filter-expression-field'
import {
  entityItemToken,
  type AutocompleteItem,
  type AutocompleteRow,
  type AutocompleteSources,
  type AutocompleteView,
} from './nlp-autocomplete'
import { NAME_MATCH_RANK, rankByName } from './nlp-resolver'

/**
 * The Review widget's filter field (widget feedback 2A, board Review-field):
 * what its popup lists and what a pick writes. The field takes a filter
 * expression (`utils/filter-expression`), and over the expression field's
 * `@ # ! /` popup it adds two lists of people, tags and statuses together,
 * each with its open tasks:
 *
 * - **browse** — the field clicked where a term may go (empty, after an
 *   operator, or after a whole term): every person, tag and status under its
 *   heading, the most counted first;
 * - **bare letters** — a name typed without `@ # !` where a term may go:
 *   the people, tags and statuses it matches (exact, initials, prefix, word
 *   start), best first.
 *
 * A pick writes the name's token (`@Aisha`, `#"R&D"`, `!Waiting`) and, after
 * a whole term, the word that joins it (`reviewFieldPick`): `or` after a
 * name of the same sort, `and` after anything else — text, so the user may
 * change the word.
 */

/** Each person's, tag's and status's open tasks (under the widget's screen filter), by id. */
export interface ReviewFieldCounts {
  person: ReadonlyMap<number, number>
  tag: ReadonlyMap<number, number>
  status: ReadonlyMap<number, number>
}

export interface ReviewFieldOptions {
  counts: ReviewFieldCounts
  /** The field was clicked (or focused while empty): an empty place for a term lists everything. */
  browse: boolean
  /** Whether a text reads as a filter (a term with no operator after it can take a joining word). */
  reads: (text: string) => boolean
}

/** What stands before the place for a term. */
type Before =
  /** Nothing, `(`, or an operator (`and` / `or` / `not`): a term goes here as it is. */
  | { kind: 'open' }
  /** A whole term: a pick joins it with a word — `or` after a name of the same sort. */
  | { kind: 'term'; sort: AutocompleteItem['kind'] | null }
  /** Something unfinished (`due`): no list, no pick here. */
  | { kind: 'none' }

const OPERATORS = new Set(['and', 'or', 'not'])
const SIGIL_SORT: Record<string, AutocompleteItem['kind']> = { '@': 'person', '#': 'tag', '!': 'status' }
/** The last token of a text: a quoted name (`@"Aisha Rahman"`), or a run without spaces or parentheses. */
const LAST_TOKEN = /(?:[@#!]"(?:[^"\\]|\\.)*"?|[^\s()]+)$/
/** A bare name being typed: it starts with a letter. */
const BARE_NAME = /^\p{L}[\p{L}\p{M}\p{N}_'&.-]*$/u
const MAX_ROWS = 8

/** What stands before `head` (the text before a term's place). */
function beforeOf(head: string, reads: (text: string) => boolean): Before {
  const trimmed = head.trimEnd()
  if (trimmed === '' || trimmed.endsWith('(')) return { kind: 'open' }
  const last = LAST_TOKEN.exec(trimmed)?.[0] ?? ''
  if (OPERATORS.has(last.toLowerCase())) return { kind: 'open' }
  // A name, or a group closed after one: whole terms, whatever is around them.
  const inner = trimmed.replace(/[\s)]+$/, '')
  const name = LAST_TOKEN.exec(inner)?.[0] ?? ''
  const sort = SIGIL_SORT[name.charAt(0)]
  if (sort && name.length > 1) return { kind: 'term', sort }
  if (trimmed.endsWith(')')) return { kind: 'term', sort: null }
  return reads(trimmed) ? { kind: 'term', sort: null } : { kind: 'none' }
}

/** The word typed at `cursor` (back to a space or parenthesis) and where it starts; null when the cursor is inside a word. */
function wordAt(value: string, cursor: number): { from: number; word: string } | null {
  const after = value.charAt(cursor)
  if (after !== '' && !/[\s)]/.test(after)) return null
  let from = cursor
  while (from > 0 && !/[\s()]/.test(value.charAt(from - 1))) from--
  return { from, word: value.slice(from, cursor) }
}

/** Whether `word` could still become an operator (`a`, `an`, `o`, `no`): after a whole term, typing one lists nothing. */
function operatorPrefix(word: string): boolean {
  const w = word.toLowerCase()
  return [...OPERATORS].some((op) => op.startsWith(w))
}

const countOf = (counts: ReviewFieldCounts, item: AutocompleteItem) => counts[item.kind].get(item.id) ?? 0

/** Every person, tag and status under its heading, the most counted first (ties in their own order). */
function browseRows(sources: AutocompleteSources, counts: ReviewFieldCounts): AutocompleteRow[] {
  const section = (items: readonly AutocompleteItem[], heading: string): AutocompleteRow[] => items
    .map((item, i) => ({ item, i, count: countOf(counts, item) }))
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .map(({ item, count }) => ({ kind: 'entity', item, resolves: false, count, section: heading }))
  const people = [...sources.people].sort((a, b) => a.name.localeCompare(b.name))
  return [...section(people, 'People'), ...section(sources.tags, 'Tags'), ...section(sources.statuses, 'Status')]
}

/** The people, tags and statuses a bare `word` matches (not only inside a word), best first. */
function bareRows(word: string, sources: AutocompleteSources, counts: ReviewFieldCounts): AutocompleteRow[] {
  const all = [...sources.people, ...sources.tags, ...sources.statuses]
  return rankByName(word, all)
    .filter(({ match }) => match.rank < NAME_MATCH_RANK.substring)
    .slice(0, MAX_ROWS)
    .map(({ item, match }) => ({
      kind: 'entity',
      item,
      // Never completed by typing on: `and`, `due`, a word of text read as typed.
      resolves: false,
      ...(match.at >= 0 ? { match: { at: match.at, length: word.length } } : {}),
      count: countOf(counts, item),
    }))
}

/**
 * The field's popup for `value` with the cursor at `cursor`: the expression
 * field's after `@ # ! /` (its names with their counts), else a bare name's
 * matches, else — `browse` — the whole list at an empty place for a term.
 * Null when nothing is to be listed (a word that is an operator or a keyword,
 * a date being typed, the cursor inside a word).
 */
export function reviewFieldAutocomplete(
  value: string,
  cursor: number,
  sources: AutocompleteSources,
  { counts, browse, reads }: ReviewFieldOptions,
): AutocompleteView | null {
  const triggered = expressionAutocomplete(value, cursor, sources)
  if (triggered) {
    if (triggered.mode !== 'entity') return triggered
    const rows = triggered.rows.map((r) => (r.kind === 'entity' ? { ...r, count: countOf(counts, r.item) } : r))
    return { ...triggered, rows }
  }
  const at = wordAt(value, cursor)
  if (!at) return null
  const before = beforeOf(value.slice(0, at.from), reads)
  if (before.kind === 'none') return null
  const base = { trigger: null, mode: 'entity' as const, mixed: true, header: '', footer: false, anchor: at.from, from: at.from, to: cursor, query: at.word }
  if (at.word === '') {
    if (!browse) return null
    const rows = browseRows(sources, counts)
    return rows.length > 0 ? { ...base, rows } : null
  }
  if (!BARE_NAME.test(at.word) || EXPRESSION_KEYWORDS.has(at.word.toLowerCase())) return null
  if (before.kind === 'term' && operatorPrefix(at.word)) return null
  const rows = bareRows(at.word, sources, counts)
  return rows.length > 0 ? { ...base, rows } : null
}

/**
 * `value` with `[from, to)` — what was typed for a name — replaced by
 * `item`'s token, joined to a whole term before it by `or` (a name of the
 * same sort) or `and` (anything else); a space after it, the cursor there.
 */
export function reviewFieldPick(
  value: string,
  from: number,
  to: number,
  item: AutocompleteItem,
  reads: (text: string) => boolean,
): { value: string; cursor: number } {
  const head = value.slice(0, from)
  const before = beforeOf(head, reads)
  const token = entityItemToken(item)
  let lead = head
  if (before.kind === 'term') lead = `${head.trimEnd()} ${before.sort === item.kind ? 'or' : 'and'} `
  else if (head !== '' && !/[\s(]$/.test(head)) lead = `${head} `
  const tail = value.slice(to).replace(/^ /, '')
  return { value: `${lead}${token} ${tail}`, cursor: lead.length + token.length + 1 }
}

/**
 * The people a filter names when it names nothing else — one person
 * (`@Aisha`), or several joined by `or` (`@Aisha or @Ben`) —, in order;
 * null for any other filter (the check-in buttons show only for these).
 */
export function peopleOnly(expression: FilterExpr | null | undefined): number[] | null {
  if (!expression) return null
  const items = expression.kind === 'or' ? expression.items : [expression]
  const ids: number[] = []
  for (const item of items) {
    if (item.kind !== 'person' || item.id === 0) return null
    if (!ids.includes(item.id)) ids.push(item.id)
  }
  return ids.length > 0 ? ids : null
}
