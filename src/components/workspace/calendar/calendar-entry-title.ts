import { calendarEntryState, type CalendarEntry } from '../../../services/calendar-entries'
import { dayLabel, shortDayLabel } from '../../../utils/calendar-grid'
import { startOfDay } from '../../../utils/date'
import { describeRecurrence } from '../../../utils/recurrence'

/** The entry's date type as its tooltip's bar draws it (`TooltipBubble`'s `bar`): its colour, and its name for assistive tech. */
export function calendarEntryBar(entry: CalendarEntry): { color: string; label: string } {
  return entry.kind === 'due'
    ? { color: 'var(--date-bar-due)', label: 'Due' }
    : { color: 'var(--date-bar-followup)', label: 'Next follow-up' }
}

/**
 * The entry's tooltip: the task (· overdue) — its date type is the bar beside
 * it (`calendarEntryBar`), as on the entry —; an occurrence explains why it
 * can't be dragged.
 */
export function calendarEntryTitle(entry: CalendarEntry, today: Date): string {
  const { todo } = entry
  if (entry.isVirtual) {
    const anchor = todo.dueDate ? startOfDay(new Date(todo.dueDate)) : undefined
    const repeats = todo.recurrenceRule ? describeRecurrence(todo.recurrenceRule, anchor) : 'Repeats'
    const own = anchor ? ` (${shortDayLabel(anchor)})` : ''
    return [
      `${todo.title} · ${dayLabel(entry.day)}`,
      `${repeats}. Click to edit the task.`,
      `Occurrences can’t be dragged: move the task’s own due date${own} instead.`,
    ].join('\n')
  }
  const state = calendarEntryState(entry, today)
  const overdue = state === 'due-overdue' || state === 'followup-overdue'
  return `${todo.title}${overdue ? ' · overdue' : ''}`
}
