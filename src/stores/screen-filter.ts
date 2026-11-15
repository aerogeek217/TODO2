import type { FilterCriteria } from '../utils/filter-criteria'
import { useFilterStore } from './filter-store'

/**
 * The screen filter as the widgets apply it: the top bar's chips
 * (`filter-store`). Everything that filters by the screen filter reads it
 * here (lists, the glance widgets, the calendar, the Neglect map, the
 * counter and the filtered tasks); what edits the chips, counts them or
 * seeds a new task from them reads `filter-store` itself.
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

/** The screen filter (`currentScreenFilter`), kept current. */
export function useScreenFilter(): ScreenFilterState {
  const filters = useFilterStore((s) => s.filters)
  const active = useFilterStore((s) => s.isActive)
  return { filters, active }
}

/** The screen filter while it narrows, else undefined — what a list composes into its own (`useBuiltList`). */
export function useActiveScreenFilter(): FilterCriteria | undefined {
  const filters = useFilterStore((s) => s.filters)
  const active = useFilterStore((s) => s.isActive)
  return active ? filters : undefined
}
