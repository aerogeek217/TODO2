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

/** True if two dates fall on the same calendar day */
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Format as "Mon DD, YYYY" */
export function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Format as "Mon DD", adding ", YYYY" only when the date is not in the current calendar year */
export function formatDateShort(date: Date): string {
  const d = new Date(date)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
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
