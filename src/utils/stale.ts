import type { TodoItem } from '../models/todo-item'
import { daysUntil } from './effective-date'
import { formatDateWith } from './date'

/**
 * Stale tasks: open tasks nobody has changed for the Settings threshold
 * ("Fade tasks untouched for N days", Settings › Tasks › Task defaults). A
 * stale row is drawn faded (D17); its title tooltip says when it was last
 * edited. Reads `modifiedAt`, which any edit moves — a reorder or a bulk
 * edit too (accepted: no separate stamp). The dashboard's Stale section has
 * its own, per-tab threshold (`services/stats/stale`).
 */

/** Fade tasks untouched for this many days, by default. */
export const DEFAULT_STALE_AFTER_DAYS = 30

/** The largest threshold the setting takes, in days. */
export const STALE_AFTER_MAX_DAYS = 365

/** Whether `n` is a threshold the setting takes: a whole number of days 0–365 (0 = off). */
export function isStaleAfterDays(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= STALE_AFTER_MAX_DAYS
}

/** The stored threshold (a whole number 0–365, as text); `undefined` when it isn't one. */
export function parseStaleAfterDays(value: string): number | undefined {
  if (!/^(0|[1-9]\d{0,2})$/.test(value)) return undefined
  const n = Number(value)
  return isStaleAfterDays(n) ? n : undefined
}

/** The fields a staleness check reads. */
export type StaleFields = Pick<TodoItem, 'modifiedAt' | 'isCompleted'>

/**
 * Days since `todo` last changed, by local day (a task changed on the
 * morning or the evening of a day counts alike); `null` for an unreadable
 * stamp.
 */
export function daysSinceModified(todo: Pick<TodoItem, 'modifiedAt'>, today: Date): number | null {
  const at = new Date(todo.modifiedAt).getTime()
  if (!Number.isFinite(at)) return null
  return -(daysUntil(todo.modifiedAt, today) ?? 0)
}

/**
 * Whether an open `todo` has gone `afterDays` or more days without a change
 * (`afterDays` 0 = off: never). A completed task is never stale (it is
 * already drawn faded).
 */
export function isStale(todo: StaleFields, today: Date, afterDays: number): boolean {
  if (afterDays <= 0 || todo.isCompleted) return false
  const days = daysSinceModified(todo, today)
  return days != null && days >= afterDays
}

/** The stale row's tooltip line: `Last edited 42 days ago · Sep 4, 2026`. */
export function staleTooltipLine(todo: Pick<TodoItem, 'modifiedAt'>, today: Date): string {
  const days = daysSinceModified(todo, today) ?? 0
  const when = formatDateWith(todo.modifiedAt, { month: 'short', day: 'numeric', year: 'numeric' })
  return `Last edited ${days === 1 ? '1 day' : `${days} days`} ago · ${when}`
}
