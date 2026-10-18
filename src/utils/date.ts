import { registerModuleReset } from './module-reset'

/** Milliseconds in one day */
export const MS_PER_DAY = 86_400_000

/** Return a new Date set to midnight of the given date */
export function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

/**
 * Midnight of `d` plus `n` calendar days. Goes through local
 * `new Date(y, m, d)` so a DST day (23 or 25 hours) never shifts the date —
 * never add `n * MS_PER_DAY` to step days.
 */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** Return today at midnight */
export function startOfToday(): Date {
  return startOfDay(new Date())
}

/** `en-US` date formats by their options, built once each (a formatter is costly to build). */
const formats = new Map<string, Intl.DateTimeFormat>()
// A formatter keeps the time zone it was built in.
registerModuleReset(() => formats.clear())

/**
 * `date` in `en-US` with `options` — what `toLocaleDateString('en-US',
 * options)` gives, without building a new formatter on every call (rows
 * format dates on every render).
 */
export function formatDateWith(date: Date, options: Intl.DateTimeFormatOptions): string {
  const d = new Date(date)
  // A formatter throws on an invalid date; toLocaleDateString reads it.
  if (Number.isNaN(d.getTime())) return d.toLocaleDateString('en-US', options)
  const key = JSON.stringify(options)
  let format = formats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', options)
    formats.set(key, format)
  }
  return format.format(d)
}

/** Format as "Mon DD, YYYY" */
export function formatDate(date: Date): string {
  return formatDateWith(date, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Format as "Mon DD", adding ", YYYY" only when the date is not in the current calendar year */
export function formatDateShort(date: Date): string {
  const d = new Date(date)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return formatDateWith(d, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** `MM/DD`, zero-padded (`10/05`) — any year (the task row's due column). */
export function formatDateNumeric(date: Date): string {
  const d = new Date(date)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/** Format as relative time: "just now", "5m ago", "3h ago", "2d ago", or "in Xd" for future */
export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - new Date(date).getTime()
  if (diff < 0) {
    const futureMins = Math.floor(-diff / 60000)
    if (futureMins < 1) return 'just now'
    if (futureMins < 60) return `in ${futureMins}m`
    const futureHours = Math.floor(futureMins / 60)
    if (futureHours < 24) return `in ${futureHours}h`
    const futureDays = Math.floor(futureHours / 24)
    return `in ${futureDays}d`
  }
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** The local calendar day of `d` as a key: `YYYY-MM-DD` (any time of that day gives the same key). */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Format a Date as "YYYY-MM-DD" for <input type="date"> */
export function toDateInputValue(date: Date | undefined): string {
  return date ? dayKey(new Date(date)) : ''
}
