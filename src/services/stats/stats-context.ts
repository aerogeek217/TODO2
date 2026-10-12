import type { PersistedTodoItem, Person, Status } from '../../models'
import type { FilterCriteria } from '../../stores/filter-store'
import { compareTodosByDate, type TodoDateField, type WeekStart } from '../../utils/effective-date'
import type { HotRule } from '../../utils/hot'
import type { UrgentDueWithinDays } from '../../utils/urgency'

/**
 * What every dashboard statistic is computed with. The functions under
 * `services/stats/` are pure `(tasks, ctx) → plain data`: the caller passes
 * the task set (usually the screen-filtered one, see `statsFilter`) and this
 * context, and gets numbers and task ids back.
 */
export interface StatsContext {
  /** Local midnight of the day the numbers are for. */
  today: Date
  weekStartsOn: WeekStart
  /** "Due date makes a task urgent" range (`null` = off). */
  urgentRange: UrgentDueWithinDays
  hotRule: HotRule
  /** Task id → assigned people (`person-store.assignedPeopleMap`). */
  assignedPeopleMap: ReadonlyMap<number, readonly Person[]>
  statuses: readonly Status[]
}

/** Days in the "next 7 days" window: today and the six days after it. */
export const NEXT_DAYS = 7

/**
 * The screen filter as the dashboard applies it: every narrowing clause, but
 * completed tasks always included. Counts only ever look at open tasks; the
 * trend needs the completed ones too, so `Show completed` changes nothing.
 */
export function statsFilter(screen: FilterCriteria): FilterCriteria {
  return { ...screen, showCompleted: true }
}

/** The open tasks of `tasks`. */
export function openTasks(tasks: readonly PersistedTodoItem[]): PersistedTodoItem[] {
  return tasks.filter((t) => !t.isCompleted)
}

/**
 * Task ids in dialog order: by `field` ascending (so overdue first), tasks
 * without that date last, ties by `sortOrder`.
 */
export function idsByDate(tasks: readonly PersistedTodoItem[], field: TodoDateField): number[] {
  return [...tasks].sort(compareTodosByDate(field)).map((t) => t.id)
}
