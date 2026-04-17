import type { RecurrenceType } from '../models'
import type { FuzzyToken, ScheduledValue } from '../models/scheduled-value'
import { MS_PER_DAY } from '../utils/date'

export interface ParsedToken {
  /**
   * 'date' covers single-word date keywords (today/tomorrow/day-names); the
   * resolver decides fuzzy-vs-precise from the value.
   * 'fuzzy-schedule' covers multi-word fuzzy windows (this week, next month, …).
   */
  type: 'date' | 'fuzzy-schedule' | 'person' | 'tag' | 'project' | 'recurrence'
  value: string
  raw: string
  start: number
  end: number
}

export interface ParsedInput {
  title: string
  tokens: ParsedToken[]
  scheduledDate?: ScheduledValue
  recurrence?: RecurrenceType
  persons: string[]
  tags: string[]
  projects: string[]
}

const PERSON_PATTERN = /@"([^"]+)"|@(\w+)/g
const TAG_PATTERN = /#([A-Za-z]\w*)/g
const PROJECT_PATTERN = /\/(\w+)/g

// Multi-word fuzzy schedule windows. Pushed before single-word DATE_KEYWORDS so
// "this week" wins overlap-dedup against any embedded day name.
const FUZZY_SCHEDULE_PATTERN = /\b(this\s+week|next\s+week|this\s+month|next\s+month)\b/gi

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

  // Extract tags (#tag)
  TAG_PATTERN.lastIndex = 0
  while ((match = TAG_PATTERN.exec(text)) !== null) {
    tokens.push({
      type: 'tag',
      value: match[1].trim(),
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

  // Remove cross-type overlaps; earlier-pushed tokens win (person/tag/project > fuzzy-schedule > date > recurrence)
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
  let recurrence: RecurrenceType | undefined
  const persons: string[] = []
  const tags: string[] = []
  const projects: string[] = []

  for (const token of tokens) {
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
    if (token.type === 'tag') tags.push(token.value)
    if (token.type === 'project') projects.push(token.value)
  }

  return { title, tokens, scheduledDate, recurrence, persons, tags, projects }
}
