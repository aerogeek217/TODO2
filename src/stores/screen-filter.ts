import { useDeferredValue } from 'react'
import { countActiveFilters, type FilterCriteria } from '../utils/filter-criteria'
import { useFilterStore } from './filter-store'

/**
 * The screen filter as the widgets apply it: the top bar's chips and the
 * expression typed beside them (`filter-store`; `FilterCriteria.expression`,
 * ANDed with the chips wherever the criteria are matched). Everything that
 * filters by the screen filter reads it here (lists, the glance widgets, the
 * calendar, the Neglect map, the counter and the filtered tasks); what edits
 * the chips, counts them or seeds a new task from them reads `filter-store`
 * itself.
 *
 * **The hooks hand the widgets the filter deferred** (`useDeferredValue`):
 * a change — Clear all filters above all, which mounts every task the
 * filter hid — first renders the top bar alone (its field, pills, funnel and
 * Filter menu read `filter-store`), which paints at once; the widgets then
 * render the new filter in a background render React yields from, instead
 * of holding the click's frame for the whole workspace (some 300 ms on a
 * seeded workspace, over a second in dev). `currentScreenFilter` is never
 * deferred.
 */

/** The screen filter as it is now (the same object while nothing changed). */
export function currentScreenFilter(): FilterCriteria {
  return useFilterStore.getState().filters
}

/** What a widget filters by: the screen filter, and whether anything narrows. */
interface ScreenFilterState {
  filters: FilterCriteria
  active: boolean
}

/** The screen filter (`currentScreenFilter`), kept current — deferred, as the module says. */
export function useScreenFilter(): ScreenFilterState {
  const filters = useDeferredValue(useFilterStore((s) => s.filters))
  return { filters, active: countActiveFilters(filters) > 0 }
}

/** The screen filter while it narrows, else undefined — what a list composes into its own (`useBuiltList`). */
export function useActiveScreenFilter(): FilterCriteria | undefined {
  const { filters, active } = useScreenFilter()
  return active ? filters : undefined
}
