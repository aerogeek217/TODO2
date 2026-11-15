import { useFilterStore } from '../../../stores/filter-store'

/**
 * A widget's "No tasks match" note when the screen filter hides everything
 * (`… hidden by the screen filter.`): the way out, the chips' Clear
 * (`Clear screen filter` / `filters`).
 */
export function screenUnhideAction(chipCount: number): { label: string; onClick: () => void } {
  return { label: chipCount > 1 ? 'Clear screen filters' : 'Clear screen filter', onClick: () => useFilterStore.getState().clearAll() }
}
