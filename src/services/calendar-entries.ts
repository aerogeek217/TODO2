import type { PersistedTodoItem, Person, Org, Status } from '../models'
import { startOfDay, MS_PER_DAY } from '../utils/date'
import { generateRecurringInstances, recurrenceAnchor } from './recurrence'

export interface CalendarEntry {
  todo: PersistedTodoItem
  isVirtual: boolean
  key: string
  people: Person[]
  orgs: Org[]
  status: Status | undefined
}

export interface BuildEntriesOptions {
  assignedPeopleMap?: Map<number, Person[]>
  assignedOrgsMap?: Map<number, Org[]>
  statuses?: readonly Status[]
}

export function dayKey(d: Date): string {
  return startOfDay(d).toISOString()
}

/**
 * Bucket todos by day for any calendar surface (CalendarView grid or canvas
 * rails calendar strip). Each entry is enriched with the people + orgs
 * assigned to its todo and the resolved Status row. Virtual recurring
 * instances inherit the parent todo's people/orgs/status.
 *
 * A task is placed on its due date's day; recurring tasks also get a virtual
 * entry on every other occurrence in range. Entries within a day are in
 * `sortOrder` order.
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
  const rangeStart = startOfDay(firstDay)
  const rangeEnd = new Date(startOfDay(lastDay).getTime() + MS_PER_DAY)
  const inRange = (d: Date) => d.getTime() >= rangeStart.getTime() && d.getTime() < rangeEnd.getTime()

  const statusById = new Map<number, Status>()
  for (const s of options.statuses ?? []) {
    if (s.id != null) statusById.set(s.id, s)
  }

  const enrich = (todo: PersistedTodoItem, isVirtual: boolean, key: string): CalendarEntry => ({
    todo,
    isVirtual,
    key,
    people: options.assignedPeopleMap?.get(todo.id) ?? [],
    orgs: options.assignedOrgsMap?.get(todo.id) ?? [],
    status: todo.statusId != null ? statusById.get(todo.statusId) : undefined,
  })

  const push = (d: Date, entry: CalendarEntry) => {
    const k = dayKey(d)
    const arr = map.get(k) ?? []
    arr.push(entry)
    map.set(k, arr)
  }

  for (const t of todos) {
    const primary = t.dueDate ? startOfDay(new Date(t.dueDate)) : null
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
