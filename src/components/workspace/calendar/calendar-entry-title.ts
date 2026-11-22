import { calendarEntryState, type CalendarEntry } from '../../../services/calendar-entries'
import { dayLabel, shortDayLabel } from '../../../utils/calendar-grid'
import { startOfDay } from '../../../utils/date'
import { describeRecurrence } from '../../../utils/recurrence'
import { TOOLTIP_BAR_HOLLOW } from '../../../utils/dom-contract'

/**
 * The entry's date type as its tooltip's bar draws it (`TooltipBubble`'s
 * `bar`): its colour — a plan's `hollow`, the hollow bar —, and its name for
 * assistive tech.
 */
export function calendarEntryBar(entry: CalendarEntry): { color: string; label: string } {
  if (entry.kind === 'plan') return { color: TOOLTIP_BAR_HOLLOW, label: 'Planned' }
  return entry.kind === 'due'
    ? { color: 'var(--date-bar-due)', label: 'Due' }
    : { color: 'var(--date-bar-followup)', label: 'Next follow-up' }
}

/**
 * The entry's tooltip: the task (· overdue; a missed plan's · delayed) — its
 * date type is the bar beside it (`calendarEntryBar`), as on the entry —; an
 * occurrence explains why it can't be dragged.
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
  return `${todo.title}${overdue ? ' · overdue' : state === 'plan-missed' ? ' · delayed' : ''}`
}
