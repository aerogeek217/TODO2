import { addDays, formatDateWith, startOfDay, MS_PER_DAY } from './date'
import type { TodoItem, PersistedTodoItem } from '../models/todo-item'
import type { DateAnchor, RelativeDateToken } from '../models/filter-predicate'
import { bySortOrder } from './sort-order'
import { describeRecurrence } from './recurrence'

/**
 * 0 = Sunday-first week (week ends Saturday).
 * 1 = Monday-first week (week ends Sunday).
 */
export type WeekStart = 0 | 1

/** Start of the week containing `today`, honoring `weekStartsOn` (0 = Sun, 1 = Mon). */
export function startOfWeek(today: Date, weekStartsOn: WeekStart): Date {
  const days = (today.getDay() - weekStartsOn + 7) % 7
  return addDays(today, -days)
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
 * `offset` is `today` plus `days` calendar days (midnight).
 */
export function resolveDateAnchor(
  anchor: DateAnchor,
  today: Date,
  weekStartsOn: WeekStart,
): Date {
  if (anchor.kind === 'fixed') return startOfDay(new Date(anchor.iso))
  if (anchor.kind === 'offset') {
    return addDays(today, anchor.days)
  }
  return resolveRelativeToken(anchor.token, today, weekStartsOn)
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

/**
 * The due column's tooltip: the full date with weekday and year, how far off
 * it is (`In 3 days`, `Due today`, `2 days overdue`), and the repeat rule.
 * Empty without a due date.
 */
export function dueTooltip(t: Pick<TodoItem, 'dueDate' | 'recurrenceRule'>, today: Date): string {
  if (!t.dueDate) return ''
  const due = startOfDay(new Date(t.dueDate))
  const full = formatDateWith(due, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const days = daysUntil(due, today) ?? 0
  const distance = days === 0 ? 'Due today'
    : days === 1 ? 'Due tomorrow'
      : days > 1 ? `In ${days} days`
        : `${-days} ${days === -1 ? 'day' : 'days'} overdue`
  const lines = [full, distance]
  if (t.recurrenceRule) lines.push(describeRecurrence(t.recurrenceRule, due))
  return lines.join('\n')
}

/** The per-task date fields lists can sort and group by. */
export type TodoDateField = 'deadline' | 'followup'

/**
 * Which date a todo contributes to a given comparator field: `'deadline'`
 * snaps the `dueDate` to its midnight; `'followup'` snaps `nextFollowupAt`
 * likewise. Returns `null` for missing values — caller sorts those last.
 */
export function pickTodoDate(
  t: PersistedTodoItem,
  field: TodoDateField,
): Date | null {
  switch (field) {
    case 'deadline': return t.dueDate ? startOfDay(new Date(t.dueDate)) : null
    case 'followup': return t.nextFollowupAt ? startOfDay(new Date(t.nextFollowupAt)) : null
  }
}

/**
 * Build a comparator over `field` for `PersistedTodoItem`: ascending, or
 * latest first with `descending`. Nulls sort last either way; ties fall
 * through to `bySortOrder` (sortOrder, then id) so the order is fully stable. Used by `listSortComparator`
 * (`services/list-sections`), which every list surface sorts with.
 */
export function compareTodosByDate(
  field: TodoDateField,
  descending = false,
): (a: PersistedTodoItem, b: PersistedTodoItem) => number {
  const sign = descending ? -1 : 1
  return (a, b) => {
    const ad = pickTodoDate(a, field)
    const bd = pickTodoDate(b, field)
    if (ad === null && bd === null) return bySortOrder(a, b)
    if (ad === null) return 1
    if (bd === null) return -1
    return (sign * (ad.getTime() - bd.getTime())) || bySortOrder(a, b)
  }
}
