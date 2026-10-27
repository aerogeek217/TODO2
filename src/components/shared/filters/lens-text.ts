import { describeFilters, predicateLineItems, type FilterChipNames } from '../../../utils/filter-chips'
import type { Lens } from '../../../utils/lens'

/**
 * A lens's filters in a line: `Status not Waiting · People not Unassigned`,
 * an or group as its chips joined with "or" (`Priority Hot or People
 * Aisha`); `Every task` with none.
 */
export function lensSummary(lens: Lens, names: FilterChipNames): string {
  const items = predicateLineItems(lens.predicate, names)
  return items.length > 0 ? describeFilters(items) : 'Every task'
}

/** The counter's words: `61 of 109 open tasks shown` (`tasks` under Show completed). */
export function shownOfTotalText(shown: number, total: number, showCompleted: boolean): string {
  return `${shown} of ${total} ${showCompleted ? 'tasks' : 'open tasks'} shown`
}
