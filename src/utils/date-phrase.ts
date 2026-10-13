import { addDays, startOfDay } from './date'

/**
 * The app's relative date words: `today`, `tomorrow` / `tmr`, `yesterday`,
 * weekday names (`fri`, `friday` — the next one, never today), `next fri`
 * (same as `fri`), `in 3 days`, and numeric `MM/DD[/YY[YY]]` (year-less dates
 * roll forward). Used by the `/due` and `/followup` commands and the
 * follow-up inputs (through `utils/followup.parseFollowupInput`).
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** Weekday index for a full name or its 3-letter abbreviation (`fri`, `friday`), else -1. */
function weekdayIndex(word: string): number {
  const w = word.toLowerCase()
  return WEEKDAYS.findIndex((d) => d === w || d.slice(0, 3) === w)
}

/** The next `target` weekday strictly after `today`. */
function nextWeekday(today: Date, target: number): Date {
  let diff = target - today.getDay()
  if (diff <= 0) diff += 7
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff)
}

/**
 * Parse a numeric date in MM/DD, MM/DD/YY or MM/DD/YYYY form.
 *  - Two-digit years are 2000–2099.
 *  - Without a year the date rolls forward: if MM/DD this year is already
 *    past, it means next year (on 12/5/26 `2/3` → 2/3/27).
 *  - Out-of-range months / days and dates JS would roll over (Feb 30) → null.
 */
export function parseNumericDate(text: string, today: Date): Date | null {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/)
  if (!match || match[1] == null || match[2] == null) return null
  const month = parseInt(match[1], 10)
  const day = parseInt(match[2], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const base = startOfDay(today)
  let year: number
  if (match[3] != null) {
    const y = parseInt(match[3], 10)
    year = match[3].length === 2 ? 2000 + y : y
  } else {
    year = base.getFullYear()
    if (new Date(year, month - 1, day).getTime() < base.getTime()) year += 1
  }
  const result = new Date(year, month - 1, day)
  if (result.getMonth() !== month - 1 || result.getDate() !== day) return null
  return result
}

/**
 * Resolve a relative date phrase (see the module comment) to local midnight,
 * or null when it isn't one. Case-insensitive; inner whitespace may repeat.
 */
export function parseDatePhrase(text: string, today: Date): Date | null {
  const lower = text.toLowerCase().trim().replace(/\s+/g, ' ')
  if (!lower) return null
  const base = startOfDay(today)
  if (lower === 'today') return base
  if (lower === 'tomorrow' || lower === 'tmr') return addDays(base, 1)
  if (lower === 'yesterday') return addDays(base, -1)
  const next = lower.match(/^next ([a-z]+)$/)
  if (next?.[1] != null) {
    const target = weekdayIndex(next[1])
    return target >= 0 ? nextWeekday(base, target) : null
  }
  const inDays = lower.match(/^in (\d{1,3}) days?$/)
  if (inDays?.[1] != null) {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + parseInt(inDays[1], 10))
  }
  const target = weekdayIndex(lower)
  if (target >= 0) return nextWeekday(base, target)
  return parseNumericDate(lower, base)
}
