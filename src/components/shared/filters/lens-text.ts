import { describeFilters, filterChips, type FilterChipNames } from '../../../utils/filter-chips'
import type { Lens } from '../../../utils/lens'

/** A lens's filters in a line: `Status not Waiting · People not Unassigned`; `Every task` with none. */
export function lensSummary(lens: Lens, names: FilterChipNames): string {
  const chips = filterChips(lens.predicate, names)
  return chips.length > 0 ? describeFilters(chips) : 'Every task'
}

/** The counter's words: `61 of 109 open tasks shown` (`tasks` under Show completed). */
export function shownOfTotalText(shown: number, total: number, showCompleted: boolean): string {
  return `${shown} of ${total} ${showCompleted ? 'tasks' : 'open tasks'} shown`
}
