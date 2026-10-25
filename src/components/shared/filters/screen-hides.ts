import { useFilterStore } from '../../../stores/filter-store'
import { useUIStore } from '../../../stores/ui-store'
import type { Lens } from '../../../utils/lens'

/**
 * A widget's "No tasks match" note when the screen filter hides everything:
 * what hides the tasks, and the way out.
 */

/** What hides the tasks: `the screen filter`, `the lens “This month”`, or `the screen filter and the lens “This month”`. */
export function screenHiderText(chipsOn: boolean, lens: Lens | undefined): string {
  if (!lens) return 'the screen filter'
  return chipsOn ? `the screen filter and the lens “${lens.name}”` : `the lens “${lens.name}”`
}

/**
 * The way out: while a chip is on, the chips' Clear (`Clear screen filter`
 * / `filters` — the lens stays, as the funnel's Clear all); with the lens
 * alone, `Lift the lens` (for now, as its glasses do).
 */
export function screenUnhideAction(chipCount: number): { label: string; onClick: () => void } {
  if (chipCount > 0) {
    return { label: chipCount === 1 ? 'Clear screen filter' : 'Clear screen filters', onClick: () => useFilterStore.getState().clearAll() }
  }
  return { label: 'Lift the lens', onClick: () => useUIStore.getState().setLensLifted(true) }
}
