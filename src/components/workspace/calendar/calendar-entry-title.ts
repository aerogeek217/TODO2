import { calendarEntryState, type CalendarEntry } from '../../../services/calendar-entries'
import { dayLabel, shortDayLabel } from '../../../utils/calendar-grid'
import { startOfDay } from '../../../utils/date'
import { describeRecurrence } from '../../../utils/recurrence'

/** The entry's tooltip: task · date type (· overdue); an occurrence explains why it can't be dragged. */
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
  const type = entry.kind === 'due' ? 'Due' : 'Next follow-up'
  const overdue = state === 'due-overdue' || state === 'followup-overdue'
  return `${todo.title} · ${type}${overdue ? ' · overdue' : ''}`
}
