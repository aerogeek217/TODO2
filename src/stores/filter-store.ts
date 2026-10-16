import { create } from 'zustand'
import { countActiveFilters, fixedAnchor, type FilterCriteria } from '../utils/filter-criteria'

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
  /** Wraps Date endpoints as `{kind:'fixed', iso}` anchors. */
  setDateRange: (start: Date | null, end: Date | null) => void
  setTags: (tags: Set<number> | null) => void
  setAllFilters: (filters: FilterCriteria) => void
  clearAll: () => void
}

const defaultFilters: FilterCriteria = {
  showCompleted: false,
  personIds: null,
  statusIds: null,
  searchText: '',
  dateField: 'deadline',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
  hasDeadline: null,
  hasFollowup: null,
  markers: null,
  tags: null,
}

function isFilterActive(f: FilterCriteria): boolean {
  return countActiveFilters(f) > 0
}

function commit(set: (s: Partial<FilterState>) => void, filters: FilterCriteria) {
  set({ filters, isActive: isFilterActive(filters) })
}

export const useFilterStore = create<FilterState>((set, get) => ({
  filters: { ...defaultFilters },
  isActive: false,

  setShowCompleted(showCompleted: boolean) {
    commit(set, { ...get().filters, showCompleted })
  },

  setPersonIds(personIds: Set<number> | null) {
    commit(set, { ...get().filters, personIds })
  },

  setStatusIds(statusIds: Set<number> | null) {
    commit(set, { ...get().filters, statusIds })
  },

  setSearchText(searchText: string) {
    commit(set, { ...get().filters, searchText })
  },

  setDateRange(start: Date | null, end: Date | null) {
    commit(set, {
      ...get().filters,
      dateRangeStart: start ? fixedAnchor(start) : null,
      dateRangeEnd: end ? fixedAnchor(end) : null,
    })
  },

  setTags(tags: Set<number> | null) {
    commit(set, { ...get().filters, tags })
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
