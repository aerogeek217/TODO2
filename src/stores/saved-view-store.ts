import { create } from 'zustand'
import { savedViewRepository } from '../data/saved-view-repository'
import type { PersistedSavedView, SavedViewFilters, ListSortBy } from '../models'
import type { FilterCriteria } from './filter-store'
import { Priority } from '../models'

interface SavedViewState {
  views: PersistedSavedView[]
  activeViewId: number | null

  load: () => Promise<void>
  saveCurrentView: (name: string, sortBy: ListSortBy, filters: FilterCriteria) => Promise<void>
  renameView: (id: number, name: string) => Promise<void>
  removeView: (id: number) => Promise<void>
  setActiveViewId: (id: number | null) => void
}

function filtersToSerializable(f: FilterCriteria): SavedViewFilters {
  return {
    priorities: f.priorities ? Array.from(f.priorities) : null,
    showCompleted: f.showCompleted,
    showAssigned: f.showAssigned,
    starredOnly: f.starredOnly,
    hardDeadlineOnly: f.hardDeadlineOnly,
    personIds: f.personIds ? Array.from(f.personIds) : null,
    tagIds: f.tagIds ? Array.from(f.tagIds) : null,
    orgIds: f.orgIds ? Array.from(f.orgIds) : null,
    dateField: f.dateField,
    dateRangeStart: f.dateRangeStart ? f.dateRangeStart.toISOString() : null,
    dateRangeEnd: f.dateRangeEnd ? f.dateRangeEnd.toISOString() : null,
    dateRangeIncludeNoDue: f.dateRangeIncludeNoDue,
  }
}

export function savedFiltersToRuntime(s: SavedViewFilters): Partial<FilterCriteria> {
  return {
    priorities: s.priorities ? new Set(s.priorities as Priority[]) : null,
    showCompleted: s.showCompleted,
    showAssigned: s.showAssigned,
    starredOnly: s.starredOnly,
    hardDeadlineOnly: s.hardDeadlineOnly,
    personIds: s.personIds ? new Set(s.personIds) : null,
    tagIds: s.tagIds ? new Set(s.tagIds) : null,
    orgIds: s.orgIds ? new Set(s.orgIds) : null,
    dateField: s.dateField ?? 'due',
    dateRangeStart: s.dateRangeStart ? new Date(s.dateRangeStart) : null,
    dateRangeEnd: s.dateRangeEnd ? new Date(s.dateRangeEnd) : null,
    dateRangeIncludeNoDue: s.dateRangeIncludeNoDue,
    searchText: '',
  }
}

export const useSavedViewStore = create<SavedViewState>((set, get) => ({
  views: [],
  activeViewId: null,

  async load() {
    const views = await savedViewRepository.getAll()
    set({ views })
  },

  async saveCurrentView(name: string, sortBy: ListSortBy, filters: FilterCriteria) {
    const { views } = get()
    const maxSort = views.length > 0 ? Math.max(...views.map((v) => v.sortOrder)) : 0
    const id = await savedViewRepository.add({
      name,
      sortBy,
      filters: filtersToSerializable(filters),
      sortOrder: maxSort + 1,
    })
    const view = { id, name, sortBy, filters: filtersToSerializable(filters), sortOrder: maxSort + 1 }
    set({ views: [...views, view], activeViewId: id })
  },

  async renameView(id: number, name: string) {
    await savedViewRepository.update(id, { name })
    set({ views: get().views.map((v) => (v.id === id ? { ...v, name } : v)) })
  },

  async removeView(id: number) {
    await savedViewRepository.remove(id)
    const { views, activeViewId } = get()
    set({
      views: views.filter((v) => v.id !== id),
      activeViewId: activeViewId === id ? null : activeViewId,
    })
  },

  setActiveViewId(id: number | null) {
    set({ activeViewId: id })
  },
}))
