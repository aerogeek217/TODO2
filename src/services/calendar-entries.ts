import type { PersistedTodoItem, Person, Status } from '../models'
import type { CalendarDateType, CalendarDateTypes } from '../models/workspace-layout'
import { addDays, dayKey, startOfDay } from '../utils/date'
import { generateRecurringInstances } from '../utils/recurrence'
import type { DateLevel } from '../utils/row-date-state'
import type { UrgentDueWithinDays } from '../utils/urgency'

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

interface BuildEntriesOptions {
  assignedPeopleMap?: Map<number, Person[]>
  statuses?: readonly Status[]
  /** Which dates to place. */
  dateTypes: CalendarDateTypes
}

const KIND_ORDER: Record<CalendarDateType, number> = { due: 0, followup: 1, plan: 2 }

/** Order within a day: due entries, then follow-ups, then plans, then the task's `sortOrder`. */
function compareCalendarEntries(a: CalendarEntry, b: CalendarEntry): number {
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
 * (`dateTypes.due`), on its next follow-up's day (`dateTypes.followup`) and
 * on its planned day (`dateTypes.plan`: `doDate`; a task held in Unplanned
 * has none) — more than once on one day when they fall on it. A completed
 * task's entries are placed as an open one's. Recurring tasks also get a virtual
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
  const types = options.dateTypes
  const rangeStart = startOfDay(firstDay)
  const rangeEnd = addDays(lastDay, 1)
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
      // A rule repeats from the due date; without one it has nothing to repeat.
      if (t.recurrenceRule && t.dueDate != null) {
        const instances = generateRecurringInstances(new Date(t.dueDate), t.recurrenceRule, rangeStart, rangeEnd)
        const primaryKey = primary ? dayKey(primary) : null
        for (const inst of instances) {
          const ik = dayKey(inst)
          if (ik === primaryKey) continue
          push(t, 'due', inst, true, `recurring-${t.id}-${ik}`)
        }
      }
    }
    if (types.followup && t.nextFollowupAt) {
      const day = startOfDay(new Date(t.nextFollowupAt))
      if (inRange(day)) push(t, 'followup', day, false, `followup-${t.id}`)
    }
    if (types.plan && t.doDate && t.unplanned !== true) {
      const day = startOfDay(new Date(t.doDate))
      if (inRange(day)) push(t, 'plan', day, false, `plan-${t.id}`)
    }
  }

  for (const [, arr] of map) arr.sort(compareCalendarEntries)
  return map
}

/** Its day is before today and its task open: the task's own date (not an occurrence). */
function isPastOpen(entry: Pick<CalendarEntry, 'isVirtual' | 'day' | 'todo'>, today: Date): boolean {
  return !entry.isVirtual && !entry.todo.isCompleted && entry.day.getTime() < startOfDay(today).getTime()
}

/** Overdue: a due date or follow-up of the task's own (not an occurrence) before today, the task open. A plan is never overdue. */
export function isEntryOverdue(entry: Pick<CalendarEntry, 'kind' | 'isVirtual' | 'day' | 'todo'>, today: Date): boolean {
  return entry.kind !== 'plan' && isPastOpen(entry, today)
}

/** A missed plan: a planned day before today, the task still open (the Planner's Delayed). Drawn faded on its day. */
export function isEntryMissed(entry: Pick<CalendarEntry, 'kind' | 'isVirtual' | 'day' | 'todo'>, today: Date): boolean {
  return entry.kind === 'plan' && isPastOpen(entry, today)
}

/**
 * A past day's wash: `'due'` when any entry on it is an overdue due date,
 * else `'followup'` when only overdue follow-ups are, else `null` (a missed
 * plan washes nothing).
 */
export function dayOverdueWash(entries: readonly CalendarEntry[], today: Date): 'due' | 'followup' | null {
  let followup = false
  for (const e of entries) {
    if (!isEntryOverdue(e, today)) continue
    if (e.kind === 'due') return 'due'
    followup = true
  }
  return followup ? 'followup' : null
}

/** How an entry looks: by date type, and whether its date is today or overdue — a plan's, missed. */
type CalendarEntryState =
  | 'due' | 'due-today' | 'due-overdue'
  | 'followup' | 'followup-today' | 'followup-overdue'
  | 'plan' | 'plan-today' | 'plan-missed'

export function calendarEntryState(entry: CalendarEntry, today: Date): CalendarEntryState {
  const kind = entry.kind
  if (kind === 'plan' && isEntryMissed(entry, today)) return 'plan-missed'
  if (kind !== 'plan' && isEntryOverdue(entry, today)) return `${kind}-overdue`
  return entry.day.getTime() === startOfDay(today).getTime() ? `${kind}-today` : kind
}

/**
 * How strongly an entry's bar draws — the ladder a row date's bar shares
 * (`utils/row-date-state.DateLevel`): `late` an overdue date (a heavier bar
 * over a faint tint), `soon` a follow-up today or an open task's due date
 * inside the Settings due-soon range (`range` days from today, as
 * `isUrgentByDate` reads a row's), else `later` (a faint bar). A completed
 * task's entries and an occurrence of a recurring one are never late; a
 * plan is always `later` (its hollow bar has no strength; a missed one is
 * faded instead).
 */
export function calendarEntryLevel(entry: CalendarEntry, today: Date, range: UrgentDueWithinDays): DateLevel {
  if (entry.kind === 'plan') return 'later'
  if (isEntryOverdue(entry, today)) return 'late'
  const days = Math.round((entry.day.getTime() - startOfDay(today).getTime()) / DAY_MS)
  if (entry.todo.isCompleted || days < 0) return 'later'
  if (entry.kind === 'followup') return days === 0 ? 'soon' : 'later'
  return range != null && days <= range ? 'soon' : 'later'
}

const DAY_MS = 86_400_000
