import type { TodoItem } from '../models/todo-item'
import { daysUntil } from './effective-date'
import { formatFollowupDay } from './followup'

/**
 * App-wide Urgent. A task is urgent when it is flagged urgent, or when its
 * due date falls within the "Due date makes a task urgent" range (overdue
 * included). The range is a day count from today (`0` = due today or
 * earlier) or `null` when the due date never makes a task urgent.
 *
 * Completed tasks are never urgent by date (an overdue date means nothing
 * once the task is done); a completed task keeps its flag.
 */

/** Days ahead a due date makes a task urgent; `null` = off. */
export type UrgentDueWithinDays = number | null

/** Default range: due within 3 days. */
export const DEFAULT_URGENT_DUE_WITHIN_DAYS = 3

/** The ranges Settings offers (Off · Today · 1 · 2 · 3 days · 1 · 2 weeks). */
export const URGENT_DUE_WITHIN_CHOICES: readonly UrgentDueWithinDays[] = [null, 0, 1, 2, 3, 7, 14]

/** Largest range accepted from storage / import. */
export const MAX_URGENT_DUE_WITHIN_DAYS = 365

/** Stored form of the Off choice in the settings row. */
export const URGENT_RANGE_OFF = 'off'

/** Settings row value → range; `undefined` when the value isn't valid. */
export function parseUrgentDueWithinDays(value: string): UrgentDueWithinDays | undefined {
  if (value === URGENT_RANGE_OFF) return null
  if (!/^\d{1,3}$/.test(value)) return undefined
  const n = Number(value)
  return n <= MAX_URGENT_DUE_WITHIN_DAYS ? n : undefined
}

/** Range → settings row value. */
export function formatUrgentDueWithinDays(range: UrgentDueWithinDays): string {
  return range == null ? URGENT_RANGE_OFF : String(range)
}

/** `Off`, `Today`, `1 day`, `3 days`, `1 week`, `2 weeks`. */
export function urgentRangeLabel(range: UrgentDueWithinDays): string {
  if (range == null) return 'Off'
  if (range === 0) return 'Today'
  if (range % 7 === 0) {
    const weeks = range / 7
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
  }
  return `${range} ${range === 1 ? 'day' : 'days'}`
}

type UrgencyFields = Pick<TodoItem, 'urgent' | 'dueDate' | 'isCompleted'>

/** Whether the due date alone makes the task urgent (open tasks only). */
export function isUrgentByDate(todo: UrgencyFields, today: Date, range: UrgentDueWithinDays): boolean {
  if (range == null || todo.isCompleted) return false
  const days = daysUntil(todo.dueDate, today)
  return days != null && days <= range
}

/** Effective urgent: flagged urgent, or due within the range (overdue included). */
export function isEffectivelyUrgent(todo: UrgencyFields, today: Date, range: UrgentDueWithinDays): boolean {
  return todo.urgent === true || isUrgentByDate(todo, today, range)
}

/**
 * What a row shows in its Urgent slot: `flag` = the urgent mark (flagged,
 * whatever the date), `date` = the clock (urgent only by its due date),
 * `null` = nothing.
 */
export type UrgentMark = 'flag' | 'date' | null

export function urgentMark(todo: UrgencyFields, today: Date, range: UrgentDueWithinDays): UrgentMark {
  if (todo.urgent === true) return 'flag'
  return isUrgentByDate(todo, today, range) ? 'date' : null
}

/** `within 3 days` / `today` — the range in a sentence. */
function withinPhrase(range: number): string {
  if (range === 0) return 'today'
  return `within ${range} ${range === 1 ? 'day' : 'days'}`
}

/**
 * The second tooltip line for a task urgent by date: `Due Tue 13, within 3
 * days.` / `Due today.` / `Overdue (Thu 8), so it counts as urgent.`
 * Empty when the task isn't urgent by date.
 */
export function urgentByDateReason(todo: UrgencyFields, today: Date, range: UrgentDueWithinDays): string {
  if (!isUrgentByDate(todo, today, range) || !todo.dueDate || range == null) return ''
  const days = daysUntil(todo.dueDate, today) ?? 0
  const day = formatFollowupDay(todo.dueDate, today)
  if (days < 0) return `Overdue (${day}), so it counts as urgent.`
  if (days === 0) return 'Due today.'
  return `Due ${day}, ${withinPhrase(range)}.`
}

/** `today` / `Tue 13` / `overdue (Thu 8)` — the due date as the clearing prompt words it. */
export function dueDatePhrase(dueDate: Date, today: Date): string {
  const days = daysUntil(dueDate, today) ?? 0
  const day = formatFollowupDay(dueDate, today)
  if (days < 0) return `overdue (${day})`
  if (days === 0) return 'today'
  return day
}
