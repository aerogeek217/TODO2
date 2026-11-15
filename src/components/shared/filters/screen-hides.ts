import { useFilterStore } from '../../../stores/filter-store'
import { countActiveFilters, type FilterCriteria } from '../../../utils/filter-criteria'

/**
 * How many filters the screen filter holds, as a reader counts them: each
 * chip, and each top-level term of the typed expression (`@A and #b` two).
 */
export function screenFilterCount(f: FilterCriteria): number {
  const expr = f.expression
  const terms = expr == null ? 0 : expr.kind === 'and' ? expr.items.length : 1
  return countActiveFilters(f) - (expr == null ? 0 : 1) + terms
}

/**
 * A widget's "No tasks match" note when the screen filter hides everything
 * (`… hidden by the screen filter.`): the way out, the chips' Clear
 * (`Clear screen filter` / `filters`, by `screenFilterCount`).
 */
export function screenUnhideAction(count: number): { label: string; onClick: () => void } {
  return { label: count > 1 ? 'Clear screen filters' : 'Clear screen filter', onClick: () => useFilterStore.getState().clearAll() }
}
