import type { PersistedTodoItem, Person, Status } from '../models'
import type { CalendarDateType, CalendarDateTypes } from '../models/workspace-layout'
import { startOfDay, MS_PER_DAY } from '../utils/date'
import { generateRecurringInstances, recurrenceAnchor } from './recurrence'

export interface CalendarEntry {
  todo: PersistedTodoItem
  /** Which of the task's dates this entry stands for. */
  kind: CalendarDateType
  /** A generated occurrence of a recurring task (not the task's own date). */
  isVirtual: boolean
  /** Midnight of the entry's day. */
  day: Date
  key: string
  people: Person[]
  status: Status | undefined
}

export interface BuildEntriesOptions {
  assignedPeopleMap?: Map<number, Person[]>
  statuses?: readonly Status[]
  /** Which dates to place. Default: due dates only. */
  dateTypes?: CalendarDateTypes
}

const DUE_ONLY: CalendarDateTypes = { due: true, followup: false }

export function dayKey(d: Date): string {
  return startOfDay(d).toISOString()
}

const KIND_ORDER: Record<CalendarDateType, number> = { due: 0, followup: 1 }

/** Order within a day: due entries before follow-up entries, then the task's `sortOrder`. */
export function compareCalendarEntries(a: CalendarEntry, b: CalendarEntry): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || a.todo.sortOrder - b.todo.sortOrder
    || a.todo.id - b.todo.id
}

/**
 * Bucket todos by day for any calendar surface. Each entry is enriched with
 * the people assigned to its todo and the resolved Status row. Virtual
 * recurring instances inherit the parent todo's people/status.
 *
 * One entry per shown date type: a task is placed on its due date's day
 * (`dateTypes.due`) and on its next follow-up's day (`dateTypes.followup`) —
 * twice on one day when both fall on it. Recurring tasks also get a virtual
 * due entry on every other occurrence in range (only while due dates are
 * shown; occurrences repeat the due date). Entries within a day are ordered
 * by {@link compareCalendarEntries}.
 */
export function buildEntries(
  todos: readonly PersistedTodoItem[],
  days: readonly Date[],
  options: BuildEntriesOptions,
): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>()
  if (days.length === 0) return map
  const firstDay = days[0]
  const lastDay = days[days.length - 1]
  if (!firstDay || !lastDay) return map
  const types = options.dateTypes ?? DUE_ONLY
  const rangeStart = startOfDay(firstDay)
  const rangeEnd = new Date(startOfDay(lastDay).getTime() + MS_PER_DAY)
  const inRange = (d: Date) => d.getTime() >= rangeStart.getTime() && d.getTime() < rangeEnd.getTime()

  const statusById = new Map<number, Status>()
  for (const s of options.statuses ?? []) {
    if (s.id != null) statusById.set(s.id, s)
  }

  const push = (todo: PersistedTodoItem, kind: CalendarDateType, day: Date, isVirtual: boolean, key: string) => {
    const k = dayKey(day)
    const arr = map.get(k) ?? []
    arr.push({
      todo,
      kind,
      isVirtual,
      day: startOfDay(day),
      key,
      people: options.assignedPeopleMap?.get(todo.id) ?? [],
      status: todo.statusId != null ? statusById.get(todo.statusId) : undefined,
    })
    map.set(k, arr)
  }

  for (const t of todos) {
    if (types.due) {
      const primary = t.dueDate ? startOfDay(new Date(t.dueDate)) : null
      if (primary && inRange(primary)) push(t, 'due', primary, false, `task-${t.id}`)
      if (t.recurrenceRule) {
        const anchor = recurrenceAnchor(t)
        if (anchor) {
          const instances = generateRecurringInstances(anchor.date, t.recurrenceRule, rangeStart, rangeEnd)
          const primaryKey = primary ? dayKey(primary) : null
          for (const inst of instances) {
            const ik = dayKey(inst)
            if (ik === primaryKey) continue
            push(t, 'due', inst, true, `recurring-${t.id}-${ik}`)
          }
        }
      }
    }
    if (types.followup && t.nextFollowupAt) {
      const day = startOfDay(new Date(t.nextFollowupAt))
      if (inRange(day)) push(t, 'followup', day, false, `followup-${t.id}`)
    }
  }

  for (const [, arr] of map) arr.sort(compareCalendarEntries)
  return map
}

/** Overdue: the task's own date (not an occurrence) is before today and the task is open. */
export function isEntryOverdue(entry: Pick<CalendarEntry, 'isVirtual' | 'day' | 'todo'>, today: Date): boolean {
  return !entry.isVirtual && !entry.todo.isCompleted && entry.day.getTime() < startOfDay(today).getTime()
}

/**
 * A past day's wash: `'due'` when any entry on it is an overdue due date,
 * else `'followup'` when only overdue follow-ups are, else `null`.
 */
export function dayOverdueWash(entries: readonly CalendarEntry[], today: Date): CalendarDateType | null {
  let followup = false
  for (const e of entries) {
    if (!isEntryOverdue(e, today)) continue
    if (e.kind === 'due') return 'due'
    followup = true
  }
  return followup ? 'followup' : null
}

/** How an entry looks: by date type, and whether its date is today or overdue. */
export type CalendarEntryState = 'due' | 'due-today' | 'due-overdue' | 'followup' | 'followup-overdue'

export function calendarEntryState(entry: CalendarEntry, today: Date): CalendarEntryState {
  const overdue = isEntryOverdue(entry, today)
  if (entry.kind === 'followup') return overdue ? 'followup-overdue' : 'followup'
  if (overdue) return 'due-overdue'
  return entry.day.getTime() === startOfDay(today).getTime() ? 'due-today' : 'due'
}

/** A compact-month day dot. */
export type CalendarDot = 'due' | 'followup' | 'occurrence' | 'due-done' | 'followup-done'

/**
 * Up to three dots for a compact-month day, in entry order. A day with any
 * follow-up always shows a follow-up dot (it takes the last place when the
 * first three entries are all due dates).
 */
export function dayDots(entries: readonly CalendarEntry[], max = 3): CalendarDot[] {
  const dot = (e: CalendarEntry): CalendarDot =>
    e.isVirtual ? 'occurrence' : e.todo.isCompleted ? (e.kind === 'due' ? 'due-done' : 'followup-done') : e.kind
  const shown = entries.slice(0, max)
  const firstFollowup = entries.find((e) => e.kind === 'followup')
  if (firstFollowup && !shown.some((e) => e.kind === 'followup') && shown.length === max) {
    shown[max - 1] = firstFollowup
  }
  return shown.map(dot)
}
