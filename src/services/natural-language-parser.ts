import { Priority } from '../models'
import type { RecurrenceType } from '../models'
import { MS_PER_DAY } from '../utils/date'

export interface ParsedToken {
  type: 'priority' | 'date' | 'person' | 'tag' | 'project' | 'recurrence'
  value: string
  raw: string
  start: number
  end: number
}

export interface ParsedInput {
  title: string
  tokens: ParsedToken[]
  priority?: Priority
  dueDate?: Date
  recurrence?: RecurrenceType
  persons: string[]
  tags: string[]
  projects: string[]
}

// !high, !medium, !med, !low, !normal
const BANG_PRIORITY_PATTERN = /!(?:high|medium|med|low|normal)/gi
// p1 = High, p2 = Medium, p3 = Normal (word boundary to avoid matching inside words)
const SHORT_PRIORITY_PATTERN = /\bp[123]\b/gi
const PERSON_PATTERN = /@"([^"]+)"|@(\w+)/g
const TAG_PATTERN = /#([A-Za-z]\w*)/g
const PROJECT_PATTERN = /\/(\w+)/g

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

const MAX_INPUT_LENGTH = 500

export function parseInput(text: string): ParsedInput {
  text = text.slice(0, MAX_INPUT_LENGTH)
  const tokens: ParsedToken[] = []
  let remaining = text

  // Extract bang priorities (!high, !medium, etc.)
  let match: RegExpExecArray | null
  BANG_PRIORITY_PATTERN.lastIndex = 0
  while ((match = BANG_PRIORITY_PATTERN.exec(text)) !== null) {
    tokens.push({
      type: 'priority',
      value: match[0].slice(1).toLowerCase(),
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  // Extract short priorities (p1, p2, p3)
  SHORT_PRIORITY_PATTERN.lastIndex = 0
  while ((match = SHORT_PRIORITY_PATTERN.exec(text)) !== null) {
    // Skip if already covered by a bang priority token at this position
    const overlaps = tokens.some((t) => t.type === 'priority' && t.start <= match!.index && t.end >= match!.index + match![0].length)
    if (overlaps) continue
    const num = match[0].charAt(1)
    const value = num === '1' ? 'high' : num === '2' ? 'medium' : 'normal'
    tokens.push({
      type: 'priority',
      value,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

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

  // Extract dates
  DATE_KEYWORDS.lastIndex = 0
  while ((match = DATE_KEYWORDS.exec(text)) !== null) {
    const parsed = parseRelativeDate(match[0])
    if (parsed) {
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

  // Sort tokens by position
  tokens.sort((a, b) => a.start - b.start)

  // Remove token text from title (work backwards to preserve indices)
  const sortedDesc = [...tokens].sort((a, b) => b.start - a.start)
  for (const token of sortedDesc) {
    remaining = remaining.slice(0, token.start) + remaining.slice(token.end)
  }
  const title = remaining.replace(/\s+/g, ' ').trim()

  // Resolve values
  let priority: Priority | undefined
  let dueDate: Date | undefined
  let recurrence: RecurrenceType | undefined
  const persons: string[] = []
  const tags: string[] = []
  const projects: string[] = []

  for (const token of tokens) {
    if (token.type === 'priority' && priority === undefined) {
      const val = token.value
      if (val === 'high') priority = Priority.High
      else if (val === 'medium' || val === 'med') priority = Priority.Medium
      else priority = Priority.Normal
    }
    if (token.type === 'date' && dueDate === undefined) {
      dueDate = parseRelativeDate(token.value) ?? undefined
    }
    if (token.type === 'recurrence' && recurrence === undefined) {
      recurrence = RECURRENCE_MAP[token.value]
    }
    if (token.type === 'person') {
      persons.push(token.value)
    }
    if (token.type === 'tag') {
      tags.push(token.value)
    }
    if (token.type === 'project') {
      projects.push(token.value)
    }
  }

  return { title, tokens, priority, dueDate, recurrence, persons, tags, projects }
}
