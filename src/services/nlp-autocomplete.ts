import type { Person, RecurrenceType, Status, Tag } from '../models'
import {
  QUICK_FOLLOWUP_INTERVALS,
  addFollowupInterval,
  formatFollowupDate,
  formatFollowupDay,
  formatFollowupInterval,
  relativeDayPhrase,
  type FollowupInterval,
} from '../utils/followup'
import { BARE_MENTION_NAME, mentionToken, parseInput } from './natural-language-parser'
import { rankPeople, rankTags } from './nlp-resolver'
import {
  COMMAND_SHAPE,
  DATE_ARGUMENT_HINT,
  REPEAT_FREQUENCIES,
  SLASH_COMMANDS,
  lookupSlashCommand,
  parseCommandDate,
  takesArgument,
  type SlashCommandName,
  type SlashCommandSpec,
} from './slash-commands'
import { collapseWhitespace } from '../utils/text'
import { byName } from '../utils/sort-order'

/**
 * The autocomplete popup for task text, as pure functions over
 * (text, cursor): which trigger the cursor is in, what the popup lists, and
 * what picking a row does to the text. React inputs drive it through
 * `hooks/use-nlp-autocomplete`; any other editor can call these directly and
 * render `components/shared/NlpPopup`.
 *
 * Triggers count only at the start of the text or after whitespace:
 *  - `@` people (substring or exact initials — an exact name or initials match
 *    first, then names starting with the query);
 *  - `#` tags (prefix — the exact name first, then alphabetical);
 *    both with a Create row below the matches unless one is exactly the name;
 *  - `/` slash commands (prefix on the name), then the command's argument
 *    (date suggestions / live parse / error, statuses, frequencies).
 */

export const NLP_TRIGGERS = ['@', '#', '/'] as const
export type NlpTrigger = (typeof NLP_TRIGGERS)[number]

export interface AutocompleteItem {
  id: number
  name: string
  color?: string
  /** People: an exact initials match counts too (as the resolver does). */
  initials?: string
  /** Statuses: the status glyph. */
  icon?: string
  kind: 'person' | 'tag' | 'status'
}

export interface AutocompleteSources {
  people: readonly AutocompleteItem[]
  tags: readonly AutocompleteItem[]
  /** Statuses in Settings order (the `/status` argument). */
  statuses: readonly AutocompleteItem[]
  /** Whether `/` opens the slash-command menu. */
  commands: boolean
  /**
   * The follow-up a new task gets by default, marked `default` in the
   * `/followup` rows: the Settings interval, or `null` while new tasks get
   * none (then `none` is the default).
   */
  followupDefault: FollowupInterval | null
  today: Date
}

export type AutocompleteRow =
  /** An existing person / tag. */
  | { kind: 'entity'; item: AutocompleteItem }
  /** Create `@name` / `#tag`: offered below the matches unless one is exactly the name; picking it creates the entity at once. */
  | { kind: 'create'; trigger: '@' | '#'; name: string }
  | { kind: 'command'; command: SlashCommandSpec; matchLength: number }
  /** An argument suggestion (`fri`, `2w`, `none`, a status, a frequency). */
  | {
    kind: 'value'
    insert: string
    label: string
    matchLength: number
    detail?: string
    note?: string
    status?: AutocompleteItem
    separator?: boolean
  }
  /** What the typed date argument reads as. */
  | { kind: 'parsed'; insert: string; date: Date; label: string; relative: string }
  /** The typed argument can't be read (not selectable). */
  | { kind: 'error'; text: string; hint: string }

export interface AutocompleteView {
  trigger: NlpTrigger
  mode: 'entity' | 'command' | 'argument'
  /** The command whose argument is being typed (`mode: 'argument'`). */
  command?: SlashCommandName
  header: string
  /** Right side of the header (`/repeat`: `from Mon 12`). */
  headerNote?: string
  /** Muted line under the header (argument grammar). */
  hint?: string
  /** The `↑↓ ⏎ pick · or type the whole command` footer (unfiltered command list). */
  footer: boolean
  rows: AutocompleteRow[]
  /** Where the popup anchors: the trigger character. */
  anchor: number
  /** The text a pick replaces: `[from, to)`, `to` being the cursor. */
  from: number
  to: number
  /** What was typed after the trigger (or the argument), as typed. */
  query: string
}

// ─── Sources ────────────────────────────────────────────────────────

/** People as candidates, in store order (stored rows only). */
export function personItems(people: readonly Person[]): AutocompleteItem[] {
  return people.flatMap((p) => (p.id === undefined ? [] : [{
    id: p.id, name: p.name, color: p.color, initials: p.initials, kind: 'person' as const,
  }]))
}

/** Tags as candidates, alphabetical (stored rows only). */
export function tagItems(tags: readonly Tag[]): AutocompleteItem[] {
  return [...tags]
    .sort(byName)
    .flatMap((t) => (t.id === undefined ? [] : [{ id: t.id, name: t.name, color: t.color, kind: 'tag' as const }]))
}

/** Statuses as candidates, in Settings order (stored rows only). */
export function statusItems(statuses: readonly Status[]): AutocompleteItem[] {
  return statuses.flatMap((s) => (s.id === undefined ? [] : [{
    id: s.id, name: s.name, color: s.color, icon: s.icon, kind: 'status' as const,
  }]))
}

/**
 * What a row stands for across re-evaluations: the same person / tag /
 * status, command or value — or the create row, whatever name it offers.
 */
function rowIdentity(row: AutocompleteRow): string {
  switch (row.kind) {
    case 'entity': return `${row.item.kind}:${row.item.id}`
    case 'create': return 'create'
    case 'command': return `command:${row.command.name}`
    case 'value': return `value:${row.insert}`
    case 'parsed': return 'parsed'
    case 'error': return 'error'
  }
}

/**
 * The active row after the popup re-evaluates: while the same list narrows
 * (same mode and trigger position), the row standing for what was
 * highlighted (the same person, tag, command…) if it is still listed;
 * otherwise the first row — the best match.
 */
export function carrySelection(
  prev: AutocompleteView | null | undefined,
  prevIndex: number,
  next: AutocompleteView,
): number {
  if (prev?.mode !== next.mode || prev.anchor !== next.anchor) return 0
  const was = prev.rows[prevIndex]
  if (!was) return 0
  const id = rowIdentity(was)
  const at = next.rows.findIndex((r) => rowIdentity(r) === id)
  return at === -1 ? 0 : at
}

/** Rows that a key or click can pick (an error row can't). */
export function isSelectable(row: AutocompleteRow | undefined): boolean {
  return row !== undefined && row.kind !== 'error'
}

/** Whether the popup shows: anything listed, or an argument hint while typing. */
export function isVisible(view: AutocompleteView | null): view is AutocompleteView {
  return view !== null && (view.rows.length > 0 || view.hint !== undefined)
}

const MAX_ENTITY_ROWS = 8
const MAX_ARGUMENT_WORDS = 4

const ARGUMENT_HEADER: Record<'due' | 'followup' | 'repeat' | 'status', string> = {
  due: 'Due date',
  followup: 'Next follow-up',
  repeat: 'Repeat',
  status: 'Status',
}

// ─── Context ────────────────────────────────────────────────────────

/** The trigger the cursor's word starts with, or null. */
function findTrigger(before: string, sources: AutocompleteSources): { trigger: NlpTrigger; index: number } | null {
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i]
    if (ch === undefined || /\s/.test(ch)) return null
    const atTokenStart = i === 0 || /\s/.test(before[i - 1] ?? '')
    if (!atTokenStart) continue
    if (ch === '@' || ch === '#' || (ch === '/' && sources.commands)) return { trigger: ch, index: i }
    return null
  }
  return null
}

const KEYWORDS = [
  'today', 'tomorrow', 'tmr', 'yesterday', 'next', 'in',
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
]
const WEEKDAY_WORDS = KEYWORDS.slice(6, 13)
const MONTH_WORDS = KEYWORDS.slice(13)

const isPrefixOf = (part: string, words: readonly string[]) =>
  part.length > 0 && words.some((w) => w.startsWith(part) && w !== part)

/**
 * Whether a date argument typed so far could still become one (`next`,
 * `in 3`, `24`, `24 oc`, `5/4/`, `wed` half-typed …) — the popup then waits
 * with the grammar hint instead of an error.
 */
export function isPartialDateArgument(text: string, command: 'due' | 'followup'): boolean {
  const t = collapseWhitespace(text.toLowerCase())
  if (!t) return true
  if (isPrefixOf(t, command === 'followup' ? [...KEYWORDS, 'none'] : KEYWORDS)) return true
  if (t === 'next' || t === 'in') return true
  if (/^next [a-z]+$/.test(t)) return isPrefixOf(t.slice(5), WEEKDAY_WORDS)
  if (/^in \d{1,3}( d(a(y)?)?)?$/.test(t)) return true
  // An interval / day number / ISO year being typed (`2`, `24`, `2026-1`), or `5/4/2`.
  if (/^\d{1,4}(-\d{0,2}(-\d?)?)?$/.test(t)) return true
  if (/^\d{1,2}\/(\d{1,2}\/(\d{1,3})?)?$/.test(t)) return true
  const isWeekday = (w: string) => WEEKDAY_WORDS.some((d) => d === w || d.slice(0, 3) === w)
  const isMonthStart = (w: string) => MONTH_WORDS.some((m) => m.startsWith(w))
  const [a, b, c, ...rest] = t.split(' ')
  if (a === undefined || rest.length > 0) return false
  if (b === undefined) return isMonthStart(a) // `october` (needs a day)
  // `24 oc…`, `tue 13`, `tue 13 oc…`
  if (c === undefined) return (/^\d{1,2}$/.test(a) && isMonthStart(b)) || (isWeekday(a) && /^\d{1,2}$/.test(b))
  return isWeekday(a) && /^\d{1,2}$/.test(b) && isMonthStart(c)
}

interface ArgumentContext { spec: SlashCommandSpec; slash: number; argStart: number; arg: string }

/** The argument command whose argument the cursor is in, or null. */
function findArgumentContext(before: string, today: Date): ArgumentContext | null {
  const re = /(^|\s)\/([A-Za-z][A-Za-z-]*)(?=[ \t])/g
  let last: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(before)) !== null) last = m
  if (!last || last[2] == null) return null
  const spec = lookupSlashCommand(last[2])
  if (!spec || !takesArgument(spec.name)) return null
  const slash = last.index + (last[1]?.length ?? 0)
  const nameEnd = slash + 1 + last[2].length
  let argStart = nameEnd
  while (argStart < before.length && (before[argStart] === ' ' || before[argStart] === '\t')) argStart++
  const arg = before.slice(argStart)
  if (/(^|\s)[@#/]/.test(arg)) return null // another token began
  const endsWithSpace = /\s$/.test(arg)
  const words = arg.trim() ? arg.trim().split(/\s+/) : []
  // The words before the one being typed must still be an argument in progress.
  const done = endsWithSpace ? words : words.slice(0, -1)
  if (done.length > 0) {
    const doneText = done.join(' ')
    if (spec.name === 'status') {
      // Only a quoted name (`"In progress"`) spans words; the closing quote ends it.
      const openQuote = doneText.startsWith('"') && (doneText.length === 1 || !doneText.endsWith('"'))
      if (!openQuote) return null
    } else if (spec.name === 'repeat') {
      return null
    } else {
      const dateCommand = spec.name as 'due' | 'followup'
      if (words.length > MAX_ARGUMENT_WORDS) return null
      if (parseCommandDate(doneText, today) !== null || doneText.toLowerCase() === 'none') return null
      if (!isPartialDateArgument(doneText, dateCommand)) return null
    }
  }
  return { spec, slash, argStart, arg }
}

// ─── Rows ───────────────────────────────────────────────────────────

/** Names a create row may offer: what `parseInput` reads as a whole `@name` / `#tag`. */
const CREATABLE: Record<'@' | '#', RegExp> = {
  '@': BARE_MENTION_NAME,
  '#': /^[A-Za-z0-9_-]+$/,
}

function entityView(
  trigger: '@' | '#',
  index: number,
  cursor: number,
  rawQuery: string,
  sources: AutocompleteSources,
): AutocompleteView | null {
  const query = rawQuery.toLowerCase()
  let items: readonly AutocompleteItem[]
  if (trigger === '#') {
    // Best match first — the ranking the typed tag resolves by.
    items = query ? rankTags(query, sources.tags) : sources.tags
  } else {
    // A leading quote (`@"First Last"` being typed) is ignored for matching.
    // Best match first — the ranking the typed name resolves by.
    items = rankPeople(query.replace(/^"/, ''), sources.people)
  }
  const rows: AutocompleteRow[] = items.slice(0, MAX_ENTITY_ROWS).map((item) => ({ kind: 'entity', item }))
  // Offer to create, below the matches, unless one of them is exactly the
  // name typed — only a name the parser reads as one token (`#q4`, `@Marco`;
  // not `##` or `#a.b`), and not while a quoted `@"First Last"` is being
  // typed (it can't be completed before the closing quote).
  const exact = items.some((item) => item.name.trim().toLowerCase() === query)
  if (!exact && query.length > 0 && CREATABLE[trigger].test(rawQuery)) {
    rows.push({ kind: 'create', trigger, name: rawQuery })
  }
  return {
    trigger,
    mode: 'entity',
    header: trigger === '#' ? 'Tags' : 'People',
    footer: false,
    rows,
    anchor: index,
    from: index,
    to: cursor,
    query: rawQuery,
  }
}

function commandView(index: number, cursor: number, query: string): AutocompleteView | null {
  if (query && !COMMAND_SHAPE.test(query)) return null // a path (`/etc/…`), `/2`…
  const q = query.toLowerCase()
  const rows: AutocompleteRow[] = SLASH_COMMANDS
    .filter((c) => c.name.startsWith(q) || c.aliases.some((a) => a.startsWith(q)))
    .map((command) => ({ kind: 'command', command, matchLength: command.name.startsWith(q) ? q.length : 0 }))
  if (rows.length === 0) return null
  return {
    trigger: '/',
    mode: 'command',
    header: 'Commands',
    footer: q.length === 0,
    rows,
    anchor: index,
    from: index,
    to: cursor,
    query,
  }
}

function dateRows(
  command: 'due' | 'followup',
  arg: string,
  sources: AutocompleteSources,
): { rows: AutocompleteRow[]; hint?: string } {
  const { today } = sources
  const typed = arg.trim()
  const lower = typed.toLowerCase().replace(/\s+/g, ' ')
  type ValueRow = Extract<AutocompleteRow, { kind: 'value' }>
  const suggestions: ValueRow[] = command === 'due'
    ? ['today', 'tomorrow', 'mon', 'fri', '1w'].map((insert) => {
      const date = parseCommandDate(insert, today)
      return { kind: 'value' as const, insert, label: insert, matchLength: 0, detail: date ? formatFollowupDay(date, today) : undefined }
    })
    : [
      ...QUICK_FOLLOWUP_INTERVALS.map((interval) => {
        const insert = formatFollowupInterval(interval)
        return {
          kind: 'value' as const,
          insert,
          label: insert,
          matchLength: 0,
          detail: formatFollowupDate(addFollowupInterval(today, interval), today),
          note: sources.followupDefault && insert === formatFollowupInterval(sources.followupDefault) ? 'default' : undefined,
        }
      }),
      {
        kind: 'value' as const,
        insert: 'none',
        label: 'none',
        matchLength: 0,
        detail: 'No follow-up',
        separator: true,
        note: sources.followupDefault ? undefined : 'default',
      },
    ]
  if (!lower) return { rows: suggestions, hint: DATE_ARGUMENT_HINT[command] }
  const date = parseCommandDate(typed, today)
  if (date) return { rows: [{ kind: 'parsed', insert: typed, date, label: formatFollowupDate(date, today), relative: relativeDayPhrase(date, today) }] }
  const matching = suggestions
    .filter((r) => r.insert.startsWith(lower))
    .map((r) => ({ ...r, matchLength: lower.length, separator: false }))
  if (matching.length > 0) return { rows: matching }
  if (isPartialDateArgument(typed, command)) return { rows: [], hint: DATE_ARGUMENT_HINT[command] }
  return { rows: [{ kind: 'error', text: `Can't read "${typed}"`, hint: `Try ${DATE_ARGUMENT_HINT[command]}` }] }
}

const weekdayShort = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short' })

function repeatDetail(frequency: RecurrenceType, due: Date | undefined): string | undefined {
  if (frequency === 'weekly') return due ? `every ${weekdayShort(due)}` : 'every week'
  if (frequency === 'biweekly') return 'every 2 weeks'
  return undefined
}

function argumentView(
  ctx: ArgumentContext,
  value: string,
  cursor: number,
  sources: AutocompleteSources,
): AutocompleteView | null {
  const name = ctx.spec.name as 'due' | 'followup' | 'repeat' | 'status'
  const base = {
    trigger: '/' as const,
    mode: 'argument' as const,
    command: name,
    header: ARGUMENT_HEADER[name],
    footer: false,
    anchor: ctx.slash,
    from: ctx.argStart,
    to: cursor,
    query: ctx.arg,
  }
  if (name === 'due' || name === 'followup') {
    const { rows, hint } = dateRows(name, ctx.arg, sources)
    return { ...base, rows, ...(hint !== undefined ? { hint } : {}) }
  }
  const q = ctx.arg.trim().replace(/^"/, '').replace(/"$/, '').toLowerCase()
  if (name === 'status') {
    const rows: AutocompleteRow[] = sources.statuses
      .filter((s) => s.name.toLowerCase().startsWith(q))
      .map((s) => ({
        kind: 'value',
        insert: /\s/.test(s.name) ? `"${s.name}"` : s.name,
        label: s.name,
        matchLength: q.length,
        status: s,
      }))
    return rows.length > 0 ? { ...base, rows } : null
  }
  const due = parseInput(value, sources.today).dueDate
  const rows: AutocompleteRow[] = REPEAT_FREQUENCIES
    .filter((f) => f.startsWith(q))
    .map((f) => ({ kind: 'value', insert: f, label: f, matchLength: q.length, detail: repeatDetail(f, due) }))
  if (rows.length === 0) return null
  return { ...base, rows, ...(due ? { headerNote: `from ${formatFollowupDay(due, sources.today)}` } : {}) }
}

/**
 * What the popup shows for `value` with the cursor at `cursor`, or null when
 * the cursor isn't in a trigger. A view may have no rows (see `isVisible`).
 */
export function computeAutocomplete(
  value: string,
  cursor: number,
  sources: AutocompleteSources,
): AutocompleteView | null {
  const before = value.slice(0, cursor)
  const found = findTrigger(before, sources)
  if (found) {
    const rawQuery = before.slice(found.index + 1)
    if (found.trigger === '/') return commandView(found.index, cursor, rawQuery)
    return entityView(found.trigger, found.index, cursor, rawQuery, sources)
  }
  if (!sources.commands) return null
  const ctx = findArgumentContext(before, sources.today)
  return ctx ? argumentView(ctx, value, cursor, sources) : null
}

// ─── Picking ────────────────────────────────────────────────────────

export interface AutocompletePick {
  value: string
  cursor: number
  /** The pick began an argument command: the popup goes on to its argument. */
  reopen: boolean
}

/** The text after picking `row` in `view`, or null for a row that can't be picked. */
export function applyAutocompletePick(
  value: string,
  view: AutocompleteView,
  row: AutocompleteRow,
): AutocompletePick | null {
  let insert: string
  let reopen = false
  switch (row.kind) {
    case 'entity': {
      // Tags stay bare (single-word); people quote a name that isn't bare
      // (a space, a hyphen …), so the token reads back as the whole name.
      insert = entityToken(view, row.item)
      break
    }
    case 'create':
      insert = `${row.trigger}${row.name}`
      break
    case 'command':
      insert = `/${row.command.name}`
      reopen = takesArgument(row.command.name)
      break
    case 'value':
    case 'parsed':
      insert = row.insert
      break
    case 'error':
      return null
  }
  const before = value.slice(0, view.from)
  const after = value.slice(view.to).replace(/^ /, '')
  const next = `${before}${insert} ${after}`
  return { value: next, cursor: before.length + insert.length + 1, reopen }
}

/**
 * `value` with the half-typed token `view` is open on completed to the
 * highlighted row (`index`; the best match — the first row — unless ↑ / ↓ or
 * the pointer moved it), for a submit that doesn't wait for a pick: a person
 * or tag, a flag command (`/ur` → `/urgent`), or an argument suggestion
 * (`/due tom` → `tomorrow`). Unchanged when nothing was typed after the
 * trigger (or the command), when the row adds nothing (a new name to create,
 * a date that already reads), for an argument command without its argument,
 * and for an unreadable or still partial argument — those stay in the title
 * as typed.
 */
export function bestMatchCompletion(value: string, view: AutocompleteView, index = 0): string {
  if (view.query.trim() === '') return value
  const row = view.rows[index]
  if (!row) return value
  if (row.kind === 'create' || row.kind === 'parsed' || row.kind === 'error') return value
  if (row.kind === 'command' && takesArgument(row.command.name)) return value
  return applyAutocompletePick(value, view, row)?.value ?? value
}

/** The token text picking an existing person / tag writes (`@Ann`, `@"Ann Lee"`, `#q4`). */
function entityToken(view: AutocompleteView, item: AutocompleteItem): string {
  return view.trigger === '#' ? `#${item.name}` : mentionToken(item.name)
}

/**
 * Typing on past an open `@` / `#` popup without picking — a space or
 * punctuation typed right after the token, or the caret moved off it — uses
 * the highlighted row: an existing person / tag completes the token to its
 * name, as Tab would, the typed key kept after it. `prev` is the text the
 * popup was open on with its view and highlighted row; `value` / `cursor`
 * the input now. Null when nothing is to be completed: another popup or the
 * same token still open (`next` visible at the same trigger), a highlighted
 * create row (the text stays as typed), nothing typed after the trigger, or
 * an edit that isn't one of those two (a deletion, a paste elsewhere).
 */
export function implicitAccept(
  prev: { value: string; view: AutocompleteView; index: number },
  value: string,
  cursor: number,
  next: AutocompleteView | null,
): { value: string; cursor: number } | null {
  const { view } = prev
  if (view.mode !== 'entity' || view.query.trim() === '') return null
  if (isVisible(next) && next.mode === view.mode && next.anchor === view.anchor) return null
  const row = view.rows[prev.index]
  if (row?.kind !== 'entity') return null
  const head = prev.value.slice(0, view.to)
  const tail = prev.value.slice(view.to)
  if (!value.startsWith(head) || !value.endsWith(tail)) return null
  const typed = value.slice(view.to, value.length - tail.length)
  // Caret moved off the token (nothing typed), or a space / punctuation typed right after it.
  if (typed !== '' && !/^[^\p{L}\p{M}\p{N}_]+$/u.test(typed)) return null
  if (typed === '' && cursor >= view.from && cursor <= view.to) return null
  const insert = entityToken(view, row.item)
  const completed = `${value.slice(0, view.from)}${insert}${value.slice(view.to)}`
  const delta = insert.length - (view.to - view.from)
  return { value: completed, cursor: cursor >= view.to ? cursor + delta : cursor }
}
