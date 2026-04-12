import { create } from 'zustand'
import { savedViewRepository } from '../data/saved-view-repository'
import type { PersistedSavedView, SavedViewFilters, ListSortBy } from '../models'
import type { FilterCriteria } from './filter-store'
import { Priority } from '../models'

interface SavedViewState {
  views: PersistedSavedView[]
  activeViewId: number | null
  loading: boolean
  error: string | null

  load: () => Promise<void>
  saveCurrentView: (name: string, sortBy: ListSortBy, filters: FilterCriteria) => Promise<void>
  updateView: (id: number, sortBy: ListSortBy, filters: FilterCriteria) => Promise<void>
  renameView: (id: number, name: string) => Promise<void>
  removeView: (id: number) => Promise<void>
  reorder: (fromIndex: number, toIndex: number) => Promise<void>
  setActiveViewId: (id: number | null) => void
}

function filtersToSerializable(f: FilterCriteria): SavedViewFilters {
  return {
    priorities: f.priorities ? Array.from(f.priorities) : null,
    completedFilter: f.completedFilter,
    assignedFilter: f.assignedFilter,
    followupFilter: f.followupFilter,
    // Backward compat: old booleans (lossy for third options)
    showCompleted: f.completedFilter !== 'incomplete' && f.completedFilter !== 'incomplete-only',
    showAssigned: f.assignedFilter !== 'unassigned' && f.assignedFilter !== 'unassigned-only',
    starredOnly: f.followupFilter === 'followup',
    hardDeadlineOnly: f.hardDeadlineOnly,
    personIds: f.personIds ? Array.from(f.personIds) : null,
    tagIds: f.tagIds ? Array.from(f.tagIds) : null,
    orgIds: f.orgIds ? Array.from(f.orgIds) : null,
    ...(f.statusIds != null ? { statusIds: Array.from(f.statusIds) } : {}),
    dateField: f.dateField,
    dateRangeStart: f.dateRangeStart ? f.dateRangeStart.toISOString() : null,
    dateRangeEnd: f.dateRangeEnd ? f.dateRangeEnd.toISOString() : null,
    dateRangeIncludeNoDue: f.dateRangeIncludeNoDue,
  }
}

export function savedFiltersToRuntime(s: SavedViewFilters): Partial<FilterCriteria> {
  return {
    priorities: s.priorities ? new Set(s.priorities as Priority[]) : null,
    completedFilter: (s.completedFilter as FilterCriteria['completedFilter']) ?? (s.showCompleted ? 'all' : 'incomplete-only'),
    assignedFilter: (s.assignedFilter as FilterCriteria['assignedFilter']) ?? (s.showAssigned ? 'all' : 'unassigned-only'),
    followupFilter: (s.followupFilter as FilterCriteria['followupFilter']) ?? (s.starredOnly ? 'followup' : 'all'),
    hardDeadlineOnly: s.hardDeadlineOnly,
    personIds: s.personIds ? new Set(s.personIds) : null,
    tagIds: s.tagIds ? new Set(s.tagIds) : null,
    orgIds: s.orgIds ? new Set(s.orgIds) : null,
    statusIds: s.statusIds ? new Set(s.statusIds) : null,
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
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const views = await savedViewRepository.getAll()
      set({ views })
    } catch (e) {
      console.error('Failed to load saved views:', e)
      set({ error: 'Failed to load saved views' })
    } finally {
      set({ loading: false })
    }
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

  async updateView(id: number, sortBy: ListSortBy, filters: FilterCriteria) {
    const serialized = filtersToSerializable(filters)
    await savedViewRepository.update(id, { sortBy, filters: serialized })
    set({ views: get().views.map((v) => (v.id === id ? { ...v, sortBy, filters: serialized } : v)), activeViewId: id })
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

  async reorder(fromIndex: number, toIndex: number) {
    const sorted = [...get().views].sort((a, b) => a.sortOrder - b.sortOrder)
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= sorted.length || toIndex >= sorted.length) return
    const [moved] = sorted.splice(fromIndex, 1)
    sorted.splice(toIndex, 0, moved)
    const updated = sorted.map((v, i) => ({ ...v, sortOrder: i }))
    set({ views: updated })
    for (const v of updated) {
      await savedViewRepository.update(v.id, { sortOrder: v.sortOrder })
    }
  },

  setActiveViewId(id: number | null) {
    set({ activeViewId: id })
  },
}))
