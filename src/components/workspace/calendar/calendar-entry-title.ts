import type { RecurrenceRule } from '../../../models/recurrence'
import { calendarEntryState, type CalendarEntry } from '../../../services/calendar-entries'
import { dayLabel, shortDayLabel } from '../../../utils/calendar-grid'
import { startOfDay } from '../../../utils/date'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${s}`
}

/** `Repeats every Monday` etc., from the rule and the task's due date. */
export function describeRecurrence(rule: RecurrenceRule, anchor: Date | undefined): string {
  const wd = anchor ? WEEKDAYS[anchor.getDay()] : undefined
  const dom = rule.originalDayOfMonth ?? anchor?.getDate()
  switch (rule.type) {
    case 'daily': return 'Repeats every day'
    case 'weekly': return wd ? `Repeats every ${wd}` : 'Repeats every week'
    case 'biweekly': return wd ? `Repeats every other ${wd}` : 'Repeats every two weeks'
    case 'monthly': return dom ? `Repeats monthly on the ${ordinal(dom)}` : 'Repeats every month'
    case 'quarterly': return 'Repeats every quarter'
    case 'yearly': return 'Repeats every year'
  }
}

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
