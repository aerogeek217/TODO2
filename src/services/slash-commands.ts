import type { Interval } from '../models'
import { parseFollowupInput } from '../utils/followup'
import { MAX_INTERVAL_COUNT, parseInterval, unitOfWord } from '../utils/interval'

/**
 * Slash commands typed into a new task's text (Quick Add, the editor's title
 * in create mode, a note line converted to a task). `/` counts only at the
 * start of the text or after whitespace, so `a/b`, `1/2`, URLs and paths are
 * never commands. Flag commands take no argument; the others take one after a
 * space. A status is named with `!`, not a command (`natural-language-parser`).
 */

export type SlashCommandName = 'urgent' | 'important' | 'focus' | 'due' | 'followup' | 'repeat'

export interface SlashCommandSpec {
  name: SlashCommandName
  /** Other accepted spellings (`/follow-up`). */
  aliases: readonly string[]
  /** Menu description; `…` means it takes an argument. */
  description: string
  /** What the argument is called in the menu header and problem lines. */
  argumentLabel?: string
}

/** The commands in menu order. */
export const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  { name: 'focus', aliases: [], description: 'Add to Focus' },
  { name: 'urgent', aliases: [], description: 'Mark urgent' },
  { name: 'important', aliases: [], description: 'Mark important' },
  { name: 'due', aliases: [], description: 'Due date…', argumentLabel: 'Due date' },
  { name: 'followup', aliases: ['follow-up'], description: 'Next follow-up…', argumentLabel: 'Next follow-up' },
  { name: 'repeat', aliases: [], description: 'Repeat…', argumentLabel: 'Repeat' },
]

/** Whether the command takes an argument. */
export function takesArgument(name: SlashCommandName): boolean {
  return name === 'due' || name === 'followup' || name === 'repeat'
}

/** The command a typed name (without the `/`) spells, any case; aliases count. */
export function lookupSlashCommand(word: string): SlashCommandSpec | undefined {
  const w = word.toLowerCase()
  return SLASH_COMMANDS.find((c) => c.name === w || c.aliases.includes(w))
}

/** A `/name` that could be a command: letters (and hyphens) up to whitespace or the end. */
export const COMMAND_SHAPE = /^[A-Za-z][A-Za-z-]*$/

/**
 * The words `/repeat` has always read, each now an interval (schema v84):
 * the autocomplete offers them, in this order, as the common repeats.
 */
export const REPEAT_WORDS: readonly { word: string; every: Interval }[] = [
  { word: 'daily', every: { count: 1, unit: 'd' } },
  { word: 'weekly', every: { count: 1, unit: 'w' } },
  { word: 'biweekly', every: { count: 2, unit: 'w' } },
  { word: 'monthly', every: { count: 1, unit: 'm' } },
  { word: 'quarterly', every: { count: 3, unit: 'm' } },
  { word: 'yearly', every: { count: 1, unit: 'y' } },
]

/** Most words a `/repeat` argument spans (`every 3 days`). */
export const MAX_REPEAT_WORDS = 3

/** Examples shown when a `/repeat` argument can't be read. */
export const REPEAT_ARGUMENT_HINT = 'weekly, monthly, 2w, every 3 days'

/**
 * The repeat a `/repeat` argument names (any case), else undefined: one of
 * the words (`weekly`, `biweekly`, `quarterly`…), an interval (`2w`, `3m`),
 * or `every` and one — `every 2w`, `every 3 days`, `every 6 months`, `every
 * week`, `every other week`.
 */
export function parseRepeatArgument(text: string): Interval | undefined {
  const w = text.trim().toLowerCase().replace(/\s+/g, ' ')
  const named = REPEAT_WORDS.find((r) => r.word === w)
  if (named) return { ...named.every }
  const bare = parseInterval(w)
  if (bare) return bare
  const every = /^every (.+)$/.exec(w)?.[1]
  if (every == null) return undefined
  const compact = parseInterval(every)
  if (compact) return compact
  const parts = every.split(' ')
  const [first = '', second] = parts
  if (second == null) {
    // `every week`: a unit's whole word (a lone letter is the compact form's).
    const unit = first.length > 1 ? unitOfWord(first) : null
    return unit ? { count: 1, unit } : undefined
  }
  const unit = parts.length === 2 && second.length > 1 ? unitOfWord(second) : null
  if (!unit) return undefined
  if (first === 'other') return { count: 2, unit }
  if (!/^\d{1,3}$/.test(first)) return undefined
  const count = parseInt(first, 10)
  return count >= 1 && count <= MAX_INTERVAL_COUNT ? { count, unit } : undefined
}

/**
 * Whether `text` may still become a `/repeat` argument as more is typed:
 * `every`, `every 3`, `every other` (what the popup keeps open on).
 */
export function isPartialRepeatArgument(text: string): boolean {
  const w = text.trim().toLowerCase().replace(/\s+/g, ' ')
  return /^every(?: (?:\d{1,3}|other))?$/.test(w)
}

/**
 * A `/due` or `/followup` date: an interval from today (`3d`, `2w`, `1m`,
 * `1y`), a relative date (`today`, `tomorrow`, `fri`, `next fri`,
 * `in 3 days`), `MM/DD[/YY[YY]]`, a day and month (`24 Oct`, `Oct 24 2027`)
 * or ISO `2026-10-24`. Year-less dates resolve forward. Local midnight, or
 * null when it isn't a date.
 */
export function parseCommandDate(text: string, today: Date): Date | null {
  const r = parseFollowupInput(text, today, 'future')
  return r.kind === 'date' ? r.date : null
}

/** Example arguments shown when a date argument can't be read. */
export const DATE_ARGUMENT_HINT: Record<'due' | 'followup', string> = {
  due: 'fri, tomorrow, 5/4, 10/30, 2w',
  followup: '2w, 1m, fri or a date',
}
