import { STATUS_UPDATE_TEXT_MAX, type StatusUpdate } from '../models/status-update'
import { startOfDay } from './date'
import { collapseWhitespace } from './text'

/**
 * The one order of a task's status updates, newest first: by `date`, then
 * by `createdAt` (entries of the same day), then by `id` (rows written
 * together). "Newest" is the first in this order.
 */
export function compareStatusUpdates(
  a: Pick<StatusUpdate, 'date' | 'createdAt' | 'id'>,
  b: Pick<StatusUpdate, 'date' | 'createdAt' | 'id'>,
): number {
  return b.date.getTime() - a.date.getTime()
    || b.createdAt.getTime() - a.createdAt.getTime()
    || (b.id ?? 0) - (a.id ?? 0)
}

/**
 * An entry's text as stored: one line (runs of whitespace, line breaks
 * included, as one space), trimmed, at most `STATUS_UPDATE_TEXT_MAX`
 * characters. Empty = no entry.
 */
export function statusUpdateText(text: string): string {
  return collapseWhitespace(text).slice(0, STATUS_UPDATE_TEXT_MAX).trim()
}

/** An entry's date as stored: the day of `date`, never after `today` (a later one is today). */
export function statusUpdateDay(date: Date, today: Date): Date {
  const day = startOfDay(date)
  const todayStart = startOfDay(today)
  return day.getTime() > todayStart.getTime() ? todayStart : day
}
