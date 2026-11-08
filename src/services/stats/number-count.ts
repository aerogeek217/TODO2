import type { PersistedTodoItem } from '../../models'
import type { NumberCompare } from '../../models/glance-widgets'
import { addDays } from '../../utils/calendar-grid'
import { compareTodosByDate, type TodoSortDateField } from '../../utils/effective-date'
import { expressionAtoms } from '../../utils/filter-expression'
import { admitsCompleted, type FilterCriteria } from '../../utils/filter-criteria'
import { matchesFilterWithLookups, type FilterSettings } from '../../utils/filter-match'
import type { TodoNameLookups } from '../../utils/filter'
import { NUMBER_HISTORY_DAYS } from '../../utils/trend-window'
import { statsFilter } from './stats-context'

/**
 * A Number's count (D26 P5): the tasks its filter keeps among the tasks the
 * top bar shows. Its filter decides completion on its own — an empty one
 * keeps every open task, a Completed range lets the completed ones it holds
 * through (`admitsCompleted`) —, and the top bar's Show completed changes
 * nothing (`statsFilter`), as for every glance widget. Pure.
 */

/** The date a Number's tasks open in, in its task dialog: the newest completion first for a filter that lets completed tasks through, else the next follow-up for one that reads only that, else the due date. */
export function numberOrderField(filter: FilterCriteria): { field: TodoSortDateField; descending: boolean } {
  if (admitsCompleted(filter)) return { field: 'completed', descending: true }
  const reads = new Set<string>(Object.entries(filter.dates).flatMap(([field, m]) => (m != null ? [field] : [])))
  if (filter.expression) for (const a of expressionAtoms(filter.expression)) if (a.kind === 'date') reads.add(a.field)
  return reads.has('followup') && !reads.has('deadline') ? { field: 'followup', descending: false } : { field: 'deadline', descending: false }
}

/**
 * The ids of the tasks of `tasks` that `filter` keeps, in dialog order
 * (`numberOrderField`; ties by `sortOrder`). `tasks` is the screen-filtered
 * set (completed tasks included, `statsFilter`) for the count, or every task
 * for the `of N`.
 */
export function numberIds(
  filter: FilterCriteria,
  tasks: readonly PersistedTodoItem[],
  lookups: TodoNameLookups,
  today: Date,
  settings: FilterSettings,
): number[] {
  const { field, descending } = numberOrderField(filter)
  return tasks
    .filter((t) => matchesFilterWithLookups(filter, t, lookups, today, settings))
    .sort(compareTodosByDate(field, descending))
    .map((t) => t.id)
}

/**
 * The stages a Number's history counts by (`filter-history.filterHistory`):
 * the screen filter (completion left to the Number, `statsFilter`), then
 * the Number's own filter.
 */
export function numberStages(screen: FilterCriteria, filter: FilterCriteria): readonly [FilterCriteria, FilterCriteria] {
  return [statsFilter(screen), filter]
}

/** A Number's history days: today and the 13 before (local midnights, oldest first). */
export function numberHistoryDays(today: Date): Date[] {
  const first = addDays(today, -(NUMBER_HISTORY_DAYS - 1))
  return Array.from({ length: NUMBER_HISTORY_DAYS }, (_, i) => addDays(first, i))
}

/**
 * Today's value against yesterday's (`today − yesterday`), or against the
 * value 7 days back (`lastWeek`: the same point of last week); `null` when
 * the line doesn't reach it or nothing is compared (`none`).
 */
export function historyDelta(values: readonly number[], against: NumberCompare): number | null {
  if (against === 'none') return null
  const today = values.at(-1)
  const then = values.at(against === 'lastWeek' ? -8 : -2)
  return today == null || then == null ? null : today - then
}
