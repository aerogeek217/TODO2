import type { RecurrenceType } from '../models'
import { parseFollowupInput } from '../utils/followup'

/**
 * Slash commands typed into a new task's text (Quick Add, the editor's title
 * in create mode, a note line converted to a task). `/` counts only at the
 * start of the text or after whitespace, so `a/b`, `1/2`, URLs and paths are
 * never commands. Flag commands take no argument; the others take one after a
 * space.
 */

export type SlashCommandName = 'urgent' | 'important' | 'focus' | 'due' | 'followup' | 'repeat' | 'status'

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
  { name: 'status', aliases: [], description: 'Set status…', argumentLabel: 'Status' },
]

/** Whether the command takes an argument. */
export function takesArgument(name: SlashCommandName): boolean {
  return name === 'due' || name === 'followup' || name === 'repeat' || name === 'status'
}

/** The command a typed name (without the `/`) spells, any case; aliases count. */
export function lookupSlashCommand(word: string): SlashCommandSpec | undefined {
  const w = word.toLowerCase()
  return SLASH_COMMANDS.find((c) => c.name === w || c.aliases.includes(w))
}

/** A `/name` that could be a command: letters (and hyphens) up to whitespace or the end. */
export const COMMAND_SHAPE = /^[A-Za-z][A-Za-z-]*$/

/** `/repeat` frequencies in menu order. */
export const REPEAT_FREQUENCIES: readonly RecurrenceType[] = [
  'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly',
]

/** The frequency a `/repeat` argument names (any case), else undefined. */
export function parseRepeatArgument(text: string): RecurrenceType | undefined {
  const w = text.trim().toLowerCase()
  return REPEAT_FREQUENCIES.find((f) => f === w)
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
