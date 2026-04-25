import type { RecurrenceType } from '../models'
import type { FuzzyToken, ScheduledValue } from '../models/scheduled-value'
import { MS_PER_DAY } from '../utils/date'
import { resolveFuzzy } from '../utils/effective-date'
import { normalizeTag } from '../utils/tags'

export interface ParsedToken {
  /**
   * 'date' covers single-word date keywords (today/tomorrow/day-names); the
   * resolver decides fuzzy-vs-precise from the value.
   * 'fuzzy-schedule' covers multi-word fuzzy windows (this week, next month, …).
   * 'deadline' covers explicit deadline syntax: `by <date>` / `!<date>` — resolves
   * to a concrete `dueDate`, never fuzzy.
   */
  type: 'date' | 'fuzzy-schedule' | 'deadline' | 'person' | 'project' | 'recurrence' | 'tag'
  value: string
  raw: string
  start: number
  end: number
}

export interface ParsedInput {
  title: string
  tokens: ParsedToken[]
  scheduledDate?: ScheduledValue
  dueDate?: Date
  recurrence?: RecurrenceType
  persons: string[]
  projects: string[]
  /** Lowercase tag slugs in first-seen order, post-`normalizeTag`. */
  tags: string[]
}

const PERSON_PATTERN = /@"([^"]+)"|@(\w+)/g
const PROJECT_PATTERN = /\/([A-Za-z0-9_-]+)/g
// Whitespace-anchored #tag — group 1 is the leading separator (empty at start
// of input) and group 2 is the slug. Separator stays in the remaining title
// after token removal.
const TAG_PATTERN = /(^|\s)#([A-Za-z0-9_-]+)/g

// Multi-word fuzzy schedule windows. Pushed before single-word DATE_KEYWORDS so
// "this week" wins overlap-dedup against any embedded day name.
const FUZZY_SCHEDULE_PATTERN = /\b(this\s+week|next\s+week|this\s+month|next\s+month)\b/gi

// Shared inner date phrase for deadline syntax. Group-1 is the date text.
const DEADLINE_DATE_INNER = String.raw`(today|tomorrow|tmr|this\s+week|next\s+week|this\s+month|next\s+month|next\s+(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|in\s+\d+\s+days?)`

// "by <date>" phrase deadline
const BY_DEADLINE_PATTERN = new RegExp(String.raw`\bby\s+` + DEADLINE_DATE_INNER + String.raw`\b`, 'gi')

// "!<date>" prefix deadline (single-word forms only)
const BANG_DEADLINE_PATTERN = /!(today|tomorrow|tmr|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi

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
  if (nextDayMatch) {
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const targetDay = dayNames.findIndex((d) => nextDayMatch[1].toLowerCase().startsWith(d))
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
  if (inDaysMatch) {
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

  return null
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

// Single-word date keywords that resolve to fuzzy tokens (Phase 3 A.4).
// 'yesterday' stays precise — when a user types it they mean the literal past date.
const FUZZY_SINGLE: Record<string, FuzzyToken> = {
  'today': 'today',
  'tomorrow': 'tomorrow',
  'tmr': 'tomorrow',
}

// Normalize a deadline date phrase to a concrete Date. Fuzzy windows
// resolve to their end-of-window date (deadline is precise-only by schema).
// Natural-language deadline parsing pins to Monday-first weeks regardless of
// the user's `weekStartsOn`: the parse runs at type-time and the user sees the
// resolved chip immediately, so locking parser semantics avoids surprise drift
// if the user later flips the setting.
function resolveDeadlineText(text: string, today: Date): Date | null {
  const lower = text.toLowerCase().trim().replace(/\s+/g, ' ')
  const fuzzyMap: Record<string, FuzzyToken> = {
    'today': 'today',
    'tomorrow': 'tomorrow',
    'tmr': 'tomorrow',
    'this week': 'this-week',
    'next week': 'next-week',
    'this month': 'this-month',
    'next month': 'next-month',
  }
  const fuzzy = fuzzyMap[lower]
  if (fuzzy) return resolveFuzzy(fuzzy, today, 1)
  return parseRelativeDate(text)
}

const MAX_INPUT_LENGTH = 500

export function parseInput(text: string): ParsedInput {
  text = text.slice(0, MAX_INPUT_LENGTH)
  const tokens: ParsedToken[] = []
  let remaining = text

  let match: RegExpExecArray | null

  // Extract people (@name or @"First Last")
  PERSON_PATTERN.lastIndex = 0
  while ((match = PERSON_PATTERN.exec(text)) !== null) {
    tokens.push({
      type: 'person',
      value: match[1] ?? match[2],
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  // Extract projects (/name) — only when preceded by whitespace or at start
  PROJECT_PATTERN.lastIndex = 0
  while ((match = PROJECT_PATTERN.exec(text)) !== null) {
    if (match.index > 0 && !/\s/.test(text[match.index - 1])) continue
    tokens.push({
      type: 'project',
      value: match[1],
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  // Extract tags (#name) — whitespace-preceded or at start of input. Pushed
  // after project extraction so `/foo` wins overlap-dedup against any
  // hypothetical conflict; leading separator in group 1 stays in the title.
  TAG_PATTERN.lastIndex = 0
  while ((match = TAG_PATTERN.exec(text)) !== null) {
    const sepLen = match[1].length
    const tagStart = match.index + sepLen
    const tagEnd = tagStart + 1 + match[2].length
    tokens.push({
      type: 'tag',
      value: match[2],
      raw: text.slice(tagStart, tagEnd),
      start: tagStart,
      end: tagEnd,
    })
  }

  // Extract explicit deadline tokens BEFORE fuzzy-schedule / date keywords so
  // the enclosing "by <date>" / "!<date>" phrase wins overlap-dedup against
  // the inner date text.
  BY_DEADLINE_PATTERN.lastIndex = 0
  while ((match = BY_DEADLINE_PATTERN.exec(text)) !== null) {
    tokens.push({
      type: 'deadline',
      value: match[1],
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  BANG_DEADLINE_PATTERN.lastIndex = 0
  while ((match = BANG_DEADLINE_PATTERN.exec(text)) !== null) {
    tokens.push({
      type: 'deadline',
      value: match[1],
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  // Extract fuzzy schedule windows BEFORE DATE_KEYWORDS so multi-word tokens
  // win the overlap-dedup pass against any bare day name embedded inside.
  FUZZY_SCHEDULE_PATTERN.lastIndex = 0
  while ((match = FUZZY_SCHEDULE_PATTERN.exec(text)) !== null) {
    tokens.push({
      type: 'fuzzy-schedule',
      value: match[0].toLowerCase().replace(/\s+/g, '-'),
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  // Extract dates
  DATE_KEYWORDS.lastIndex = 0
  while ((match = DATE_KEYWORDS.exec(text)) !== null) {
    const lower = match[0].toLowerCase()
    if (FUZZY_SINGLE[lower] || parseRelativeDate(match[0])) {
      tokens.push({
        type: 'date',
        value: match[0],
        raw: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
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

  // Remove cross-type overlaps; earlier-pushed tokens win (person/project > fuzzy-schedule > date > recurrence)
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
  let scheduledDate: ScheduledValue | undefined
  let dueDate: Date | undefined
  let recurrence: RecurrenceType | undefined
  const persons: string[] = []
  const projects: string[] = []
  const tags: string[] = []
  const seenTags = new Set<string>()
  const now = new Date()

  for (const token of tokens) {
    if (token.type === 'deadline' && dueDate === undefined) {
      const parsed = resolveDeadlineText(token.value, now)
      if (parsed) dueDate = parsed
    }
    if (token.type === 'fuzzy-schedule' && scheduledDate === undefined) {
      scheduledDate = { kind: 'fuzzy', token: token.value as FuzzyToken }
    }
    if (token.type === 'date' && scheduledDate === undefined) {
      const lower = token.value.toLowerCase()
      if (FUZZY_SINGLE[lower]) {
        scheduledDate = { kind: 'fuzzy', token: FUZZY_SINGLE[lower] }
      } else {
        const parsed = parseRelativeDate(token.value)
        if (parsed) scheduledDate = { kind: 'date', value: parsed }
      }
    }
    if (token.type === 'recurrence' && recurrence === undefined) {
      recurrence = RECURRENCE_MAP[token.value]
    }
    if (token.type === 'person') persons.push(token.value)
    if (token.type === 'project') projects.push(token.value)
    if (token.type === 'tag') {
      const slug = normalizeTag(token.value)
      if (slug && !seenTags.has(slug)) {
        seenTags.add(slug)
        tags.push(slug)
      }
    }
  }

  return { title, tokens, scheduledDate, dueDate, recurrence, persons, projects, tags }
}
