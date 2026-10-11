import type { PersistedTodoItem, Person, Org, Status } from '../../../../models'
import {
  buildEntries as buildEntriesShared,
  dayKey,
  type CalendarEntry,
} from '../../../../services/calendar-entries'
import type { EventRowEntry } from './EventRow'

/**
 * Canvas calendar strip uses the `EventRowEntry` interface (people / orgs /
 * status all required). The shared `CalendarEntry` matches that surface area
 * — the alias keeps existing call-site types stable.
 */
export type StripEntry = CalendarEntry & EventRowEntry

export { dayKey }

/**
 * Bucket todos by day for the calendar strip. Thin wrapper over the shared
 * `services/calendar-entries.buildEntries`.
 */
export function buildEntries(
  todos: PersistedTodoItem[],
  days: Date[],
  assignedPeopleMap: Map<number, Person[]>,
  assignedOrgsMap: Map<number, Org[]>,
  statuses: Status[],
): Map<string, StripEntry[]> {
  return buildEntriesShared(todos, days, {
    assignedPeopleMap,
    assignedOrgsMap,
    statuses,
  }) as Map<string, StripEntry[]>
}
