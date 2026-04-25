import type { PersistedTodoItem, Person, Org, Status } from '../models'
import { startOfDay, MS_PER_DAY } from '../utils/date'
import { effectiveDate, resolveScheduled, type WeekStart } from '../utils/effective-date'
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
  today: Date
  weekStartsOn: WeekStart
  /**
   * Sort within each day's entry list.
   *  - `sortOrder`  — pure `sortOrder` ascending (canvas calendar strip).
   *  - `effective`  — `effectiveDate` ascending, then `sortOrder` (CalendarView grid).
   */
  sortMode: 'sortOrder' | 'effective'
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
 * The placement primary is `resolvedScheduled ?? deadline` — matching the
 * existing CalendarView semantic where a user-set scheduled day wins over the
 * deadline (so dragging a card to a new day actually moves it even when its
 * deadline lies earlier). Falling back to `effectiveDate` would clamp the
 * card back to `min(scheduled, deadline)`.
 */
export function buildEntries(
  todos: readonly PersistedTodoItem[],
  days: readonly Date[],
  options: BuildEntriesOptions,
): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>()
  if (days.length === 0) return map
  const { today, weekStartsOn, sortMode } = options
  const rangeStart = startOfDay(days[0])
  const rangeEnd = new Date(startOfDay(days[days.length - 1]).getTime() + MS_PER_DAY)
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
    const sched = resolveScheduled(t.scheduledDate, today, weekStartsOn)
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
    if (sortMode === 'effective') {
      arr.sort((a, b) => {
        const ae = effectiveDate(a.todo, today, weekStartsOn)
        const be = effectiveDate(b.todo, today, weekStartsOn)
        if (ae && be && ae.getTime() !== be.getTime()) return ae.getTime() - be.getTime()
        return a.todo.sortOrder - b.todo.sortOrder
      })
    } else {
      arr.sort((a, b) => a.todo.sortOrder - b.todo.sortOrder)
    }
  }
  return map
}
