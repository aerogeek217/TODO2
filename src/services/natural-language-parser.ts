import type { RecurrenceType } from '../models'
import { MS_PER_DAY } from '../utils/date'
import { normalizeTag } from '../utils/tags'

export interface ParsedToken {
  /**
   * 'deadline' covers explicit due-date syntax: `by <date>` / `due <date>` /
   * `!<date>`. 'date' covers a bare date phrase (today, fri, this week,
   * 5/4, …). Both resolve to `dueDate`; an explicit 'deadline' wins over a
   * bare 'date'. Windows (this week / next month) resolve to their last day.
   */
  type: 'date' | 'deadline' | 'person' | 'recurrence' | 'tag' | 'status'
  value: string
  raw: string
  start: number
  end: number
}

export interface ParsedInput {
  title: string
  tokens: ParsedToken[]
  dueDate?: Date
  recurrence?: RecurrenceType
  persons: string[]
  /** User-supplied tag names in first-seen order (trimmed, original case
   * preserved). Dedup is by case-folded slug so `#Foo` and `#foo` collapse to
   * one entry — the first-seen case wins. Resolver lookup is also
   * case-insensitive (`nlp-resolver.resolveTags`). */
  tags: string[]
  /** Raw status names from `:foo` tokens in first-seen order. Resolved against
   * the status registry by `resolveInput`; the parser stays store-free. */
  statuses: string[]
}

// `@` mentions name a person. The parser stays store-free and emits
// `'person'`-typed tokens; `nlp-resolver.ts` looks the names up.
const MENTION_PATTERN = /@"([^"]+)"|@(\w+)/g
// Whitespace-anchored #tag — group 1 is the leading separator (empty at start
// of input) and group 2 is the slug. Separator stays in the remaining title
// after token removal.
const TAG_PATTERN = /(^|\s)#([A-Za-z0-9_-]+)/g

// Whitespace-anchored :status. First char must be a letter (so a stray `:` in
// `12:30` / `notes: thing` doesn't trip — the leading-whitespace anchor would
// already reject the latter; the letter-start anchors the former). Resolved
// against the status registry by the resolver — the parser only extracts.
const STATUS_PATTERN = /(^|\s):([A-Za-z][A-Za-z0-9_-]*)\b/g

// Multi-word date windows. Pushed before single-word DATE_KEYWORDS so
// "this week" wins overlap-dedup against any embedded day name.
const DATE_WINDOW_PATTERN = /\b(this\s+week|next\s+week|this\s+month|next\s+month)\b/gi

// Numeric date sub-phrase: MM/DD with optional /YY or /YYYY suffix. Used both
// inside deadline syntax (`due 5/4`, `by 6/3/27`) and as the bare date
// form. Year resolution lives in `parseNumericDate` — when omitted, the parser
// rolls forward (past MM/DD → next year).
const NUMERIC_DATE_SUB = String.raw`\d{1,2}\/\d{1,2}(?:\/(?:\d{2}|\d{4}))?`

// Shared inner date phrase for deadline syntax. Group-1 is the date text.
const DEADLINE_DATE_INNER = String.raw`(today|tomorrow|tmr|this\s+week|next\s+week|this\s+month|next\s+month|next\s+(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|in\s+\d+\s+days?|` + NUMERIC_DATE_SUB + String.raw`)`

// "by <date>" phrase deadline
const BY_DEADLINE_PATTERN = new RegExp(String.raw`\bby\s+` + DEADLINE_DATE_INNER + String.raw`\b`, 'gi')

// "due <date>" phrase deadline — mirrors `BY_DEADLINE_PATTERN`. `:due` is a
// status name (handled by STATUS_PATTERN), so the bare-word `due` here does
// not collide.
const DUE_DEADLINE_PATTERN = new RegExp(String.raw`\bdue\s+` + DEADLINE_DATE_INNER + String.raw`\b`, 'gi')

// "!<date>" prefix deadline (single-word forms + numeric MM/DD)
const BANG_DEADLINE_PATTERN = new RegExp(
  String.raw`!(today|tomorrow|tmr|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|` + NUMERIC_DATE_SUB + String.raw`)\b`,
  'gi',
)

// Bare numeric date (MM/DD, MM/DD/YY, MM/DD/YYYY) — extracted as a `'date'`
// token, like `today` / `tomorrow` / day names. Lookbehind/lookahead reject digit-or-slash neighbours
// so paths like `path/12/05/file` and ISO-ish `2025/12/05` don't match.
const NUMERIC_DATE_PATTERN = /(?<![\d/.])\d{1,2}\/\d{1,2}(?:\/(?:\d{2}|\d{4}))?(?![\d/])/g

function parseRelativeDate(text: string): Date | null {
  const lower = text.toLowerCase().trim()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (lower === 'today') return today
  if (lower === 'tomorrow' || lower === 'tmr') {
    return new Date(today.getTime() + MS_PER_DAY)
  }
  if (lower === 'yesterday') {
    return new Date(today.getTime() - MS_PER_DAY)
  }

  // "next Monday", "next friday", etc.
  const nextDayMatch = lower.match(/^next\s+(mon|tue|wed|thu|fri|sat|sun)\w*/i)
  if (nextDayMatch && nextDayMatch[1] != null) {
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const matchedDay = nextDayMatch[1]
    const targetDay = dayNames.findIndex((d) => matchedDay.toLowerCase().startsWith(d))
    if (targetDay >= 0) {
      const result = new Date(today)
      const currentDay = result.getDay()
      let diff = targetDay - currentDay
      if (diff <= 0) diff += 7
      result.setDate(result.getDate() + diff)
      return result
    }
  }

  // "in N days"
  const inDaysMatch = lower.match(/^in\s+(\d+)\s+days?$/i)
  if (inDaysMatch && inDaysMatch[1] != null) {
    return new Date(today.getTime() + parseInt(inDaysMatch[1]) * MS_PER_DAY)
  }

  // Day names without "next" — assume this coming one
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayAbbrevs = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  for (let i = 0; i < dayNames.length; i++) {
    if (lower === dayNames[i] || lower === dayAbbrevs[i]) {
      const result = new Date(today)
      const currentDay = result.getDay()
      let diff = i - currentDay
      if (diff <= 0) diff += 7
      result.setDate(result.getDate() + diff)
      return result
    }
  }

  // Numeric MM/DD, MM/DD/YY, MM/DD/YYYY
  const numeric = parseNumericDate(text, today)
  if (numeric) return numeric

  return null
}

/**
 * Parse a numeric date string in MM/DD, MM/DD/YY, or MM/DD/YYYY form.
 *  - Two-digit years are interpreted as 2000–2099.
 *  - When the year is omitted, the date rolls forward: if MM/DD this year is
 *    already past, advance to next year (so on 12/5/26 "due 2/3" → 2/3/27).
 *  - Out-of-range months/days, and dates that JS would silently roll over
 *    (Feb 30 → Mar 2, Feb 29 in a non-leap year), return null.
 */
function parseNumericDate(text: string, today: Date): Date | null {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/)
  if (!match) return null

  const monthRaw = match[1]
  const dayRaw = match[2]
  const yearRaw = match[3]
  if (monthRaw == null || dayRaw == null) return null

  const month = parseInt(monthRaw, 10)
  const day = parseInt(dayRaw, 10)
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  let year: number
  if (yearRaw != null) {
    const y = parseInt(yearRaw, 10)
    year = yearRaw.length === 2 ? 2000 + y : y
  } else {
    year = today.getFullYear()
    const candidate = new Date(year, month - 1, day)
    if (candidate.getTime() < today.getTime()) year += 1
  }

  const result = new Date(year, month - 1, day)
  if (result.getMonth() !== month - 1 || result.getDate() !== day) return null
  return result
}

// Patterns that look like dates in natural text
const DATE_KEYWORDS = /\b(today|tomorrow|tmr|yesterday|(?:next\s+)?(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|in\s+\d+\s+days?)\b/gi

// Recurrence patterns: "every day", "every week", "every 2 weeks", "repeat daily", etc.
const RECURRENCE_PATTERN = /\b(?:every\s+(?:day|week|2\s+weeks|month|quarter|year)|repeat\s+(?:daily|weekly|biweekly|monthly|quarterly|yearly))\b/gi

const RECURRENCE_MAP: Record<string, RecurrenceType> = {
  'every day': 'daily', 'every week': 'weekly', 'every 2 weeks': 'biweekly',
  'every month': 'monthly', 'every quarter': 'quarterly', 'every year': 'yearly',
  'repeat daily': 'daily', 'repeat weekly': 'weekly', 'repeat biweekly': 'biweekly',
  'repeat monthly': 'monthly', 'repeat quarterly': 'quarterly', 'repeat yearly': 'yearly',
}

/**
 * Last day of a date window (`this week` / `next week` / `this month` /
 * `next month`) relative to `today`, at midnight; null for other text. Weeks
 * are pinned Monday-first regardless of the user's `weekStartsOn`: the parse
 * runs at type-time and the user sees the resolved chip immediately, so
 * locking parser semantics avoids surprise drift if the setting changes.
 */
function resolveDateWindow(lower: string, today: Date): Date | null {
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  const toSunday = (7 - today.getDay()) % 7
  switch (lower) {
    case 'this week': return new Date(y, m, d + toSunday)
    case 'next week': return new Date(y, m, d + toSunday + 7)
    case 'this month': return new Date(y, m + 1, 0)
    case 'next month': return new Date(y, m + 2, 0)
    default: return null
  }
}

// Normalize a date phrase to a concrete midnight Date.
function resolveDeadlineText(text: string, today: Date): Date | null {
  const lower = text.toLowerCase().trim().replace(/\s+/g, ' ')
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return resolveDateWindow(lower, base) ?? parseRelativeDate(text)
}

/**
 * Resolve a standalone date phrase (the same grammar `by <date>` / `due <date>`
 * accept: `today`, `tomorrow`, day names, `next fri`, `in 3 days`, `this week`,
 * `MM/DD[/YY]`, …) to a midnight Date, or null when it isn't one. Used by date
 * inputs outside free-text parsing (the follow-up input).
 */
export function parseDatePhrase(text: string, today: Date): Date | null {
  if (!text.trim()) return null
  return resolveDeadlineText(text, today)
}

const MAX_INPUT_LENGTH = 500

export function parseInput(text: string): ParsedInput {
  text = text.slice(0, MAX_INPUT_LENGTH)
  const tokens: ParsedToken[] = []
  let remaining = text

  let match: RegExpExecArray | null

  // Extract @-mentions (@name or @"First Last").
  MENTION_PATTERN.lastIndex = 0
  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    const value = match[1] ?? match[2]
    if (value == null) continue
    tokens.push({
      type: 'person',
      value,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  // Extract tags (#name) — whitespace-preceded or at start of input; the
  // leading separator in group 1 stays in the title.
  TAG_PATTERN.lastIndex = 0
  while ((match = TAG_PATTERN.exec(text)) !== null) {
    const sep = match[1]
    const name = match[2]
    if (sep == null || name == null) continue
    const sepLen = sep.length
    const tagStart = match.index + sepLen
    const tagEnd = tagStart + 1 + name.length
    tokens.push({
      type: 'tag',
      value: name,
      raw: text.slice(tagStart, tagEnd),
      start: tagStart,
      end: tagEnd,
    })
  }

  // Extract statuses (:name) — whitespace-preceded or at start of input.
  // Pushed before deadlines / dates so `:tomorrow` (status) wins overlap-dedup
  // against any same-text date keyword. `!<weekday>` deadline syntax uses `!`
  // not `:` and stays unaffected.
  STATUS_PATTERN.lastIndex = 0
  while ((match = STATUS_PATTERN.exec(text)) !== null) {
    const sep = match[1]
    const name = match[2]
    if (sep == null || name == null) continue
    const sepLen = sep.length
    const statusStart = match.index + sepLen
    const statusEnd = statusStart + 1 + name.length
    tokens.push({
      type: 'status',
      value: name,
      raw: text.slice(statusStart, statusEnd),
      start: statusStart,
      end: statusEnd,
    })
  }

  // Extract explicit deadline tokens BEFORE date windows / date keywords so
  // the enclosing "by <date>" / "!<date>" phrase wins overlap-dedup against
  // the inner date text.
  BY_DEADLINE_PATTERN.lastIndex = 0
  while ((match = BY_DEADLINE_PATTERN.exec(text)) !== null) {
    const value = match[1]
    if (value == null) continue
    tokens.push({
      type: 'deadline',
      value,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  DUE_DEADLINE_PATTERN.lastIndex = 0
  while ((match = DUE_DEADLINE_PATTERN.exec(text)) !== null) {
    const value = match[1]
    if (value == null) continue
    tokens.push({
      type: 'deadline',
      value,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  BANG_DEADLINE_PATTERN.lastIndex = 0
  while ((match = BANG_DEADLINE_PATTERN.exec(text)) !== null) {
    const value = match[1]
    if (value == null) continue
    tokens.push({
      type: 'deadline',
      value,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  // Extract date windows BEFORE DATE_KEYWORDS so multi-word tokens win the
  // overlap-dedup pass against any bare day name embedded inside.
  DATE_WINDOW_PATTERN.lastIndex = 0
  while ((match = DATE_WINDOW_PATTERN.exec(text)) !== null) {
    tokens.push({
      type: 'date',
      value: match[0],
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  // Extract dates
  DATE_KEYWORDS.lastIndex = 0
  while ((match = DATE_KEYWORDS.exec(text)) !== null) {
    if (parseRelativeDate(match[0])) {
      tokens.push({
        type: 'date',
        value: match[0],
        raw: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  // Extract bare numeric dates (MM/DD, MM/DD/YY, MM/DD/YYYY). Pushed after the
  // deadline patterns so `due 5/4` already owns those positions; non-prefixed
  // numeric dates land here as `'date'` tokens.
  NUMERIC_DATE_PATTERN.lastIndex = 0
  while ((match = NUMERIC_DATE_PATTERN.exec(text)) !== null) {
    if (!parseRelativeDate(match[0])) continue
    tokens.push({
      type: 'date',
      value: match[0],
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  // Extract recurrence
  RECURRENCE_PATTERN.lastIndex = 0
  while ((match = RECURRENCE_PATTERN.exec(text)) !== null) {
    tokens.push({
      type: 'recurrence',
      value: match[0].toLowerCase(),
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  // Remove cross-type overlaps; earlier-pushed tokens win (person > deadline > date > recurrence)
  const deduped: ParsedToken[] = []
  for (const token of tokens) {
    const overlaps = deduped.some((t) => token.start < t.end && token.end > t.start)
    if (!overlaps) deduped.push(token)
  }
  tokens.length = 0
  tokens.push(...deduped)

  // Sort tokens by position
  tokens.sort((a, b) => a.start - b.start)

  // Remove token text from title (work backwards to preserve indices)
  const sortedDesc = [...tokens].sort((a, b) => b.start - a.start)
  for (const token of sortedDesc) {
    remaining = remaining.slice(0, token.start) + remaining.slice(token.end)
  }
  const title = remaining.replace(/\s+/g, ' ').trim()

  // Resolve values
  let dueDate: Date | undefined
  let bareDate: Date | undefined
  let recurrence: RecurrenceType | undefined
  const persons: string[] = []
  const tags: string[] = []
  const statuses: string[] = []
  const seenTags = new Set<string>()
  const now = new Date()

  for (const token of tokens) {
    if (token.type === 'deadline' && dueDate === undefined) {
      const parsed = resolveDeadlineText(token.value, now)
      if (parsed) dueDate = parsed
    }
    if (token.type === 'date' && bareDate === undefined) {
      const parsed = resolveDeadlineText(token.value, now)
      if (parsed) bareDate = parsed
    }
    if (token.type === 'recurrence' && recurrence === undefined) {
      recurrence = RECURRENCE_MAP[token.value]
    }
    if (token.type === 'person') persons.push(token.value)
    if (token.type === 'tag') {
      // Dedup by case-folded slug (`normalizeTag`), but write the user-supplied
      // case (trimmed) so `#FooBar` round-trips as `FooBar`. The resolver
      // (`nlp-resolver.resolveTags`) also matches case-insensitively, so the
      // registry never gets two entries for the same case-folded name.
      const slug = normalizeTag(token.value)
      if (slug && !seenTags.has(slug)) {
        seenTags.add(slug)
        tags.push(token.value.trim())
      }
    }
    if (token.type === 'status') statuses.push(token.value)
  }

  return { title, tokens, dueDate: dueDate ?? bareDate, recurrence, persons, tags, statuses }
}
