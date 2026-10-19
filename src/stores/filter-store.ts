import { create } from 'zustand'
import type { NegatableField } from '../models'
import { withDateMatch } from '../utils/date-filters'
import { countActiveFilters, fixedAnchor, type FilterCriteria } from '../utils/filter-criteria'
import { isNegated, withIdFilter, withNormalizedNegation } from '../utils/filter-negation'

/**
 * The screen (top-bar) filter. The criteria type, its converters and the
 * evaluators are in `utils/filter-criteria` / `utils/filter-match`.
 */

interface FilterState {
  filters: FilterCriteria
  /** Derived: true when any filter is active. Use useFilterStore(s => s.isActive) or getState().isActive. */
  readonly isActive: boolean

  setShowCompleted: (show: boolean) => void
  setPersonIds: (personIds: Set<number> | null) => void
  setStatusIds: (statusIds: Set<number> | null) => void
  setSearchText: (text: string) => void
  /** The due-date range, Date endpoints as `{kind:'fixed', iso}` anchors; both `null` = no due-date filter. */
  setDateRange: (start: Date | null, end: Date | null) => void
  setTags: (tags: Set<number> | null) => void
  /**
   * Turns a People / Status / Tags filter's "is not" switch on or off,
   * keeping its ticks. A field that doesn't filter has no switch to keep
   * (the pickers hold an "is not" with nothing ticked themselves).
   */
  setNegated: (field: NegatableField, negated: boolean) => void
  setAllFilters: (filters: FilterCriteria) => void
  clearAll: () => void
}

const defaultFilters: FilterCriteria = {
  showCompleted: false,
  personIds: null,
  statusIds: null,
  searchText: '',
  dates: {},
  markers: null,
  tags: null,
}

function isFilterActive(f: FilterCriteria): boolean {
  return countActiveFilters(f) > 0
}

/** Stores `filters` with its "is not" switches normalised (an "is not" with nothing ticked = no filter). */
function commit(set: (s: Partial<FilterState>) => void, filters: FilterCriteria) {
  const normalized = withNormalizedNegation(filters)
  set({ filters: normalized, isActive: isFilterActive(normalized) })
}

export const useFilterStore = create<FilterState>((set, get) => ({
  filters: { ...defaultFilters },
  isActive: false,

  setShowCompleted(showCompleted: boolean) {
    commit(set, { ...get().filters, showCompleted })
  },

  setPersonIds(personIds: Set<number> | null) {
    const filters = get().filters
    commit(set, withIdFilter(filters, 'personIds', personIds, isNegated(filters, 'personIds')))
  },

  setStatusIds(statusIds: Set<number> | null) {
    const filters = get().filters
    commit(set, withIdFilter(filters, 'statusIds', statusIds, isNegated(filters, 'statusIds')))
  },

  setSearchText(searchText: string) {
    commit(set, { ...get().filters, searchText })
  },

  setDateRange(start: Date | null, end: Date | null) {
    const filters = get().filters
    commit(set, {
      ...filters,
      dates: withDateMatch(filters.dates, 'deadline', {
        match: 'range',
        start: start ? fixedAnchor(start) : null,
        end: end ? fixedAnchor(end) : null,
      }),
    })
  },

  setTags(tags: Set<number> | null) {
    const filters = get().filters
    commit(set, withIdFilter(filters, 'tags', tags, isNegated(filters, 'tags')))
  },

  setNegated(field: NegatableField, negated: boolean) {
    const filters = get().filters
    commit(set, withIdFilter(filters, field, filters[field], negated))
  },

  setAllFilters(filters: FilterCriteria) {
    commit(set, { ...filters })
  },

  clearAll() {
    set({
      filters: { ...defaultFilters },
      isActive: false,
    })
  },
}))
