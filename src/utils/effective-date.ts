import { startOfDay, startOfToday, MS_PER_DAY, formatDateShort } from './date'
import type { FuzzyToken, ScheduledValue } from '../models/scheduled-value'
import type { TodoItem, PersistedTodoItem } from '../models/todo-item'
import type { DateAnchor, RelativeDateToken } from '../models/filter-predicate'
import { bySortOrder } from './sort-order'

/**
 * 0 = Sunday-first week (week ends Saturday).
 * 1 = Monday-first week (week ends Sunday).
 */
export type WeekStart = 0 | 1

/**
 * Resolve a fuzzy token to a concrete Date: the end-of-window (inclusive last day),
 * anchored on `today`. Used by the *event*-side resolution path in `discipline.ts`,
 * where each event carries its own as-of (`event.timestamp`). Todo-side fuzzy
 * resolution should anchor on the value's `setAt` — see `resolveFuzzyOrigin`.
 */
export function resolveFuzzy(token: FuzzyToken, today: Date, weekStartsOn: WeekStart): Date {
  const base = startOfDay(today)
  switch (token) {
    case 'today':
      return base
    case 'tomorrow':
      return startOfDay(new Date(base.getTime() + MS_PER_DAY))
    case 'this-week': {
      const endDow = weekStartsOn === 1 ? 0 : 6 // Sunday if Monday-first, Saturday if Sunday-first
      const dow = base.getDay()
      const days = (endDow - dow + 7) % 7
      return startOfDay(new Date(base.getTime() + days * MS_PER_DAY))
    }
    case 'next-week': {
      const endDow = weekStartsOn === 1 ? 0 : 6
      const dow = base.getDay()
      const days = (endDow - dow + 7) % 7
      return startOfDay(new Date(base.getTime() + (days + 7) * MS_PER_DAY))
    }
    case 'this-month':
      return new Date(base.getFullYear(), base.getMonth() + 1, 0)
    case 'next-month':
      return new Date(base.getFullYear(), base.getMonth() + 2, 0)
  }
}

/**
 * Resolve a fuzzy token to its *originally-intended* end-of-window — same
 * window-math as `resolveFuzzy`, but anchored on the value's `setAt` (when the
 * user picked the token) instead of `today`. This is the right anchor for
 * todo-side fuzzy `scheduledDate`: a "this week" picked three weeks ago should
 * resolve to that week's window-end, not the current one. Used by
 * `resolveScheduled` and the aged-vocabulary `scheduledLabel`.
 */
export function resolveFuzzyOrigin(token: FuzzyToken, setAt: Date, weekStartsOn: WeekStart): Date {
  return resolveFuzzy(token, setAt, weekStartsOn)
}

/** Start of the week containing `today`, honoring `weekStartsOn` (0 = Sun, 1 = Mon). */
export function startOfWeek(today: Date, weekStartsOn: WeekStart): Date {
  const base = startOfDay(today)
  const dow = base.getDay()
  const days = (dow - weekStartsOn + 7) % 7
  return new Date(base.getTime() - days * MS_PER_DAY)
}

/**
 * Resolve a `RelativeDateToken` to a concrete midnight Date. Week tokens honor
 * `weekStartsOn`. Month tokens work off calendar month boundaries regardless
 * of week start.
 */
export function resolveRelativeToken(
  token: RelativeDateToken,
  today: Date,
  weekStartsOn: WeekStart,
): Date {
  const base = startOfDay(today)
  const dow = base.getDay()

  const addDays = (d: Date, n: number) =>
    startOfDay(new Date(d.getTime() + n * MS_PER_DAY))

  const endOfWeek = () => {
    const endDow = weekStartsOn === 1 ? 0 : 6
    const days = (endDow - dow + 7) % 7
    return addDays(base, days)
  }
  const startOfMonth = () => new Date(base.getFullYear(), base.getMonth(), 1)
  const endOfMonth = () => new Date(base.getFullYear(), base.getMonth() + 1, 0)

  switch (token) {
    case 'yesterday':
      return addDays(base, -1)
    case 'today':
      return base
    case 'tomorrow':
      return addDays(base, 1)
    case 'start-of-week':
      return startOfWeek(today, weekStartsOn)
    case 'end-of-week':
      return endOfWeek()
    case 'start-of-next-week':
      return addDays(startOfWeek(today, weekStartsOn), 7)
    case 'end-of-next-week':
      return addDays(endOfWeek(), 7)
    case 'start-of-month':
      return startOfMonth()
    case 'end-of-month':
      return endOfMonth()
    case 'start-of-next-month':
      return new Date(base.getFullYear(), base.getMonth() + 1, 1)
    case 'end-of-next-month':
      return new Date(base.getFullYear(), base.getMonth() + 2, 0)
    case 'end-of-month-plus-3':
      return new Date(base.getFullYear(), base.getMonth() + 4, 0)
  }
}

/**
 * Resolve a `DateAnchor` to a concrete midnight Date. `fixed` parses the ISO
 * string; `relative` resolves against `today` via `resolveRelativeToken`;
 * `offset` is `today + days * MS_PER_DAY` (truncated to midnight).
 */
export function resolveDateAnchor(
  anchor: DateAnchor,
  today: Date,
  weekStartsOn: WeekStart,
): Date {
  if (anchor.kind === 'fixed') return startOfDay(new Date(anchor.iso))
  if (anchor.kind === 'offset') {
    return startOfDay(new Date(startOfDay(today).getTime() + anchor.days * MS_PER_DAY))
  }
  return resolveRelativeToken(anchor.token, today, weekStartsOn)
}

/**
 * Resolve scheduledDate to a concrete Date, or null if unset.
 *
 * Fuzzy values resolve against their `setAt` stamp (origin-anchored), so a
 * "this week" picked three weeks ago resolves to that week's window-end. The
 * `today` argument stays in the signature for API symmetry — only the precise
 * `kind: 'date'` branch ignores it, the fuzzy branch dispatches to
 * `resolveFuzzyOrigin(s.token, s.setAt, weekStartsOn)`.
 */
export function resolveScheduled(
  s: ScheduledValue | undefined,
  _today: Date,
  weekStartsOn: WeekStart,
): Date | null {
  if (!s) return null
  if (s.kind === 'date') return startOfDay(new Date(s.value))
  return resolveFuzzyOrigin(s.token, new Date(s.setAt), weekStartsOn)
}

/**
 * The unified "when does this task want attention" date.
 * Returns min(resolvedScheduled, deadline), or null if both absent (Someday).
 */
export function effectiveDate(
  t: Pick<TodoItem, 'scheduledDate' | 'dueDate'>,
  today: Date,
  weekStartsOn: WeekStart,
): Date | null {
  const sched = resolveScheduled(t.scheduledDate, today, weekStartsOn)
  const due = t.dueDate ? startOfDay(new Date(t.dueDate)) : null
  if (sched && due) return sched < due ? sched : due
  return sched ?? due
}

/**
 * True when `scheduledDate` is fuzzy and its origin-resolved end-of-window is
 * before today. Precise-scheduled tasks are NOT "expired"; this is only for
 * fuzzy values. Anchored on `setAt`, so a "this week" picked three weeks ago
 * fires `true` once the week passes.
 */
export function isScheduledExpired(
  t: Pick<TodoItem, 'scheduledDate'>,
  today: Date,
  weekStartsOn: WeekStart,
): boolean {
  if (!t.scheduledDate || t.scheduledDate.kind !== 'fuzzy') return false
  const resolved = resolveFuzzyOrigin(t.scheduledDate.token, new Date(t.scheduledDate.setAt), weekStartsOn)
  return resolved < startOfDay(today)
}

/**
 * True when the scheduled date's resolved day is before today — covers both
 * fuzzy-expired (origin-anchored end-of-window passed) and precise past dates.
 * Used for "past" chip styling; `isScheduledExpired` remains fuzzy-only.
 */
export function isScheduledPast(
  t: Pick<TodoItem, 'scheduledDate'>,
  today: Date,
  weekStartsOn: WeekStart,
): boolean {
  const resolved = resolveScheduled(t.scheduledDate, today, weekStartsOn)
  if (!resolved) return false
  return resolved < startOfDay(today)
}

/** True when the deadline is before today. */
export function isDeadlinePast(
  t: Pick<TodoItem, 'dueDate'>,
  today: Date,
): boolean {
  if (!t.dueDate) return false
  return startOfDay(new Date(t.dueDate)) < startOfDay(today)
}

/**
 * Human-readable label for a scheduled chip.
 *
 * Fuzzy values render aged labels: a "this week" picked three weeks ago shows
 * its formatted intended date, not "This week". The vocabulary collapses to
 * "Today / Yesterday / Tomorrow / This week / Last week / Next week / This
 * month / Last month / Next month" when the intended window aligns with
 * today's frame, and falls through to `formatDateShort(intended)` otherwise.
 * `weekStartsOn` is required so week-boundary comparisons honor the user's
 * setting.
 */
export function scheduledLabel(s: ScheduledValue, today: Date, weekStartsOn: WeekStart): string {
  if (s.kind === 'date') {
    const d = startOfDay(new Date(s.value))
    const base = startOfDay(today)
    const diff = Math.round((d.getTime() - base.getTime()) / MS_PER_DAY)
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Tomorrow'
    if (diff === -1) return 'Yesterday'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Fuzzy: compare the *originally-intended* window to today's frame.
  const setAt = new Date(s.setAt)
  const intended = resolveFuzzyOrigin(s.token, setAt, weekStartsOn)
  const base = startOfDay(today)
  const dayDiff = Math.round((intended.getTime() - base.getTime()) / MS_PER_DAY)

  switch (s.token) {
    case 'today': {
      if (dayDiff === 0) return 'Today'
      if (dayDiff === -1) return 'Yesterday'
      return formatDateShort(intended)
    }
    case 'tomorrow': {
      if (dayDiff === 0) return 'Today'
      if (dayDiff === -1) return 'Yesterday'
      if (dayDiff === 1) return 'Tomorrow'
      return formatDateShort(intended)
    }
    case 'this-week':
    case 'next-week': {
      const todaysEow = resolveFuzzy('this-week', today, weekStartsOn)
      const weekDiff = Math.round((intended.getTime() - todaysEow.getTime()) / (MS_PER_DAY * 7))
      if (weekDiff === 0) return 'This week'
      if (weekDiff === 1) return 'Next week'
      if (weekDiff === -1) return 'Last week'
      return formatDateShort(intended)
    }
    case 'this-month':
    case 'next-month': {
      const intendedIdx = intended.getFullYear() * 12 + intended.getMonth()
      const todayIdx = today.getFullYear() * 12 + today.getMonth()
      const monthDiff = intendedIdx - todayIdx
      if (monthDiff === 0) return 'This month'
      if (monthDiff === 1) return 'Next month'
      if (monthDiff === -1) return 'Last month'
      return formatDateShort(intended)
    }
  }
}

/**
 * Days from `today` to `d` (both normalized to midnight). Negative = past.
 * Returns null when `d` is null/undefined.
 */
export function daysUntil(d: Date | null | undefined, today: Date): number | null {
  if (!d) return null
  const target = startOfDay(new Date(d)).getTime()
  const base = startOfDay(today).getTime()
  return Math.round((target - base) / MS_PER_DAY)
}

/**
 * Proximity factor in [0.15, 1] — used to fade chip color from greyscale (far)
 * toward the full color (at or past the date). Linear ramp over 14 days, with
 * a floor so distant chips stay legible rather than becoming invisible.
 */
export function dateIntensity(days: number | null | undefined): number {
  if (days == null) return 1
  if (days <= 0) return 1
  const f = 1 - days / 14
  return Math.max(0.15, f)
}

/** Structural equality for ScheduledValue (handles Date by time, fuzzy by token). */
export function scheduledValuesEqual(a?: ScheduledValue | null, b?: ScheduledValue | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'fuzzy' && b.kind === 'fuzzy') return a.token === b.token
  if (a.kind === 'date' && b.kind === 'date') {
    return new Date(a.value).getTime() === new Date(b.value).getTime()
  }
  return false
}

export { startOfToday }

/**
 * Which date a todo contributes to a given comparator field. `'date'` uses the
 * unified `effectiveDate` (min(scheduled, deadline)); `'scheduled'` resolves
 * the scheduled value (precise or fuzzy-aged); `'deadline'` snaps the
 * `dueDate` to its midnight. Returns `null` for missing values — caller sorts
 * those last.
 */
export function pickTodoDate(
  t: PersistedTodoItem,
  field: 'date' | 'scheduled' | 'deadline',
  today: Date,
  weekStartsOn: WeekStart,
): Date | null {
  switch (field) {
    case 'date': return effectiveDate(t, today, weekStartsOn)
    case 'scheduled': return t.scheduledDate ? resolveScheduled(t.scheduledDate, today, weekStartsOn) : null
    case 'deadline': return t.dueDate ? startOfDay(new Date(t.dueDate)) : null
  }
}

/**
 * Build an ascending comparator over `field` for `PersistedTodoItem`. Nulls
 * sort last; ties fall through to `bySortOrder` (sortOrder, then id) so the
 * order is fully stable. Used by ListView's `itemSortComparator` and
 * dashboard-lists' per-field comparators — both surfaces sort the same set
 * the same way.
 */
export function compareTodosByDate(
  field: 'date' | 'scheduled' | 'deadline',
  today: Date,
  weekStartsOn: WeekStart,
): (a: PersistedTodoItem, b: PersistedTodoItem) => number {
  return (a, b) => {
    const ad = pickTodoDate(a, field, today, weekStartsOn)
    const bd = pickTodoDate(b, field, today, weekStartsOn)
    if (ad === null && bd === null) return bySortOrder(a, b)
    if (ad === null) return 1
    if (bd === null) return -1
    return (ad.getTime() - bd.getTime()) || bySortOrder(a, b)
  }
}
