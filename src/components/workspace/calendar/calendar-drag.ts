import { createContext } from 'react'
import type { CalendarDateType } from '../../../models/workspace-layout'
import type { CalendarEntry } from '../../../services/calendar-entries'
import type { CalendarEntrySize } from './CalendarEntryButton'

/**
 * Drag data of a calendar entry, merged into the task drag payload.
 * `calendarDateType` makes a drop move that date (see
 * `resolveCalendarDropType`); `calendarEntry` draws the lifted entry.
 */
export interface CalendarEntryDragData {
  calendarDateType: CalendarDateType
  calendarEntry: {
    entry: CalendarEntry
    size: CalendarEntrySize
    wrap: boolean
    today: Date
  }
}

export function isCalendarEntryDragData(v: unknown): v is CalendarEntryDragData {
  if (v == null || typeof v !== 'object') return false
  const d = v as Partial<CalendarEntryDragData>
  return (d.calendarDateType === 'due' || d.calendarDateType === 'followup') && d.calendarEntry != null
}

/** The day a list drag was dropped on while the Due / Follow-up chooser is open. */
export interface PendingCalendarDrop {
  /** The calendar's drop scope. */
  scope: string
  /** Midnight of the day, in ms. */
  dateMs: number
}

/** Keeps the dropped-on day highlighted while the chooser asks which date to set. */
export const PendingCalendarDropContext = createContext<PendingCalendarDrop | null>(null)

/** A calendar's drop scope (distinct droppable ids per widget). */
export function calendarScope(tabId: string): string {
  return `ws-${tabId}`
}
