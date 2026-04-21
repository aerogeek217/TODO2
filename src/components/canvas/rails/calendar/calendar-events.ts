import type { PersistedTodoItem, Person, Org, Status } from '../../../../models'
import { startOfDay, MS_PER_DAY } from '../../../../utils/date'
import { resolveScheduled } from '../../../../utils/effective-date'
import { generateRecurringInstances, recurrenceAnchor } from '../../../../services/recurrence'
import type { EventRowEntry } from './EventRow'

export interface StripEntry extends EventRowEntry {
  key: string
}

export function dayKey(d: Date): string {
  return startOfDay(d).toISOString()
}

/**
 * Bucket todos by day for the calendar strip, enriching each entry with
 * the people + orgs assigned to its todo and the resolved Status row.
 * Virtual recurring instances inherit the parent todo's people/orgs/status.
 */
export function buildEntries(
  todos: PersistedTodoItem[],
  days: Date[],
  today: Date,
  assignedPeopleMap: Map<number, Person[]>,
  assignedOrgsMap: Map<number, Org[]>,
  statuses: Status[],
): Map<string, StripEntry[]> {
  const map = new Map<string, StripEntry[]>()
  if (days.length === 0) return map
  const rangeStart = startOfDay(days[0])
  const rangeEnd = new Date(startOfDay(days[days.length - 1]).getTime() + MS_PER_DAY)
  const inRange = (d: Date) => d.getTime() >= rangeStart.getTime() && d.getTime() < rangeEnd.getTime()

  const statusById = new Map<number, Status>()
  for (const s of statuses) {
    if (s.id != null) statusById.set(s.id, s)
  }

  const enrich = (todo: PersistedTodoItem, isVirtual: boolean, key: string): StripEntry => ({
    todo,
    isVirtual,
    key,
    people: assignedPeopleMap.get(todo.id) ?? [],
    orgs: assignedOrgsMap.get(todo.id) ?? [],
    status: todo.statusId != null ? statusById.get(todo.statusId) : undefined,
  })

  const push = (d: Date, entry: StripEntry) => {
    const k = dayKey(d)
    const arr = map.get(k) ?? []
    arr.push(entry)
    map.set(k, arr)
  }

  for (const t of todos) {
    // Placement uses scheduled ?? deadline (matches CalendarView):
    // the user's scheduledDate wins even when it's past the deadline, so
    // drag-to-reschedule actually moves the card. Using effectiveDate
    // (= min(sched, due)) would clamp the card back to the deadline day.
    const sched = resolveScheduled(t.scheduledDate, today)
    const primary = sched ?? (t.dueDate ? startOfDay(new Date(t.dueDate)) : null)
    if (primary && inRange(primary)) {
      push(primary, enrich(t, false, `task-${t.id}`))
    }
    if (t.recurrenceRule) {
      const anchor = recurrenceAnchor(t)
      if (!anchor) continue
      const instances = generateRecurringInstances(anchor.date, t.recurrenceRule, rangeStart, rangeEnd)
      const primaryKey = primary ? dayKey(primary) : null
      for (const inst of instances) {
        const ik = dayKey(inst)
        if (ik === primaryKey) continue
        push(inst, enrich(t, true, `recurring-${t.id}-${ik}`))
      }
    }
  }

  for (const [, arr] of map) {
    arr.sort((a, b) => a.todo.sortOrder - b.todo.sortOrder)
  }
  return map
}
