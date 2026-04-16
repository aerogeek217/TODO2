import { create } from 'zustand'
import { savedViewRepository } from '../data/saved-view-repository'
import { db } from '../data/database'
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
    showCompleted: f.showCompleted,
    showHiddenStatuses: f.showHiddenStatuses,
    hardDeadlineOnly: f.hardDeadlineOnly,
    personIds: f.personIds ? Array.from(f.personIds) : null,
    personFilterMode: f.personFilterMode,
    tagIds: f.tagIds ? Array.from(f.tagIds) : null,
    orgIds: f.orgIds ? Array.from(f.orgIds) : null,
    orgFilterMode: f.orgFilterMode,
    ...(f.statusIds != null ? { statusIds: Array.from(f.statusIds) } : {}),
    dateField: f.dateField,
    dateRangeStart: f.dateRangeStart ? f.dateRangeStart.toISOString() : null,
    dateRangeEnd: f.dateRangeEnd ? f.dateRangeEnd.toISOString() : null,
    dateRangeIncludeNoDue: f.dateRangeIncludeNoDue,
  }
}

export function savedFiltersToRuntime(s: SavedViewFilters): Partial<FilterCriteria> {
  // Backward compat: old saved views have completedFilter/assignedFilter strings
  // but not the new boolean fields. Detect by checking for legacy string fields.
  const hasLegacyFormat = s.completedFilter !== undefined || s.assignedFilter !== undefined
  let showCompleted: boolean
  let showHiddenStatuses: boolean
  if (hasLegacyFormat) {
    // Old format: derive booleans from legacy string filters
    const cf = s.completedFilter as string | undefined
    showCompleted = cf === 'all' || cf === 'completed'
    const af = s.assignedFilter as string | undefined
    showHiddenStatuses = af === 'all' || af === 'assigned'
  } else {
    // New format: use directly
    showCompleted = s.showCompleted
    showHiddenStatuses = s.showHiddenStatuses
  }

  return {
    priorities: s.priorities ? new Set(s.priorities as Priority[]) : null,
    showCompleted,
    showHiddenStatuses,
    hardDeadlineOnly: s.hardDeadlineOnly,
    personIds: s.personIds ? new Set(s.personIds) : null,
    personFilterMode: s.personFilterMode === 'direct-only' ? 'direct-only' : 'include-orgs',
    tagIds: s.tagIds ? new Set(s.tagIds) : null,
    orgIds: s.orgIds ? new Set(s.orgIds) : null,
    orgFilterMode: s.orgFilterMode === 'direct-only' ? 'direct-only' : 'include-people',
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
    try {
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
    } catch (e) {
      console.error('Failed to save view:', e)
      set({ error: 'Failed to save view' })
    }
  },

  async updateView(id: number, sortBy: ListSortBy, filters: FilterCriteria) {
    try {
      const serialized = filtersToSerializable(filters)
      await savedViewRepository.update(id, { sortBy, filters: serialized })
      set({ views: get().views.map((v) => (v.id === id ? { ...v, sortBy, filters: serialized } : v)), activeViewId: id })
    } catch (e) {
      console.error('Failed to update view:', e)
      set({ error: 'Failed to update view' })
    }
  },

  async renameView(id: number, name: string) {
    try {
      await savedViewRepository.update(id, { name })
      set({ views: get().views.map((v) => (v.id === id ? { ...v, name } : v)) })
    } catch (e) {
      console.error('Failed to rename view:', e)
      set({ error: 'Failed to rename view' })
    }
  },

  async removeView(id: number) {
    try {
      await savedViewRepository.remove(id)
      const { views, activeViewId } = get()
      set({
        views: views.filter((v) => v.id !== id),
        activeViewId: activeViewId === id ? null : activeViewId,
      })
    } catch (e) {
      console.error('Failed to remove view:', e)
      set({ error: 'Failed to remove view' })
    }
  },

  async reorder(fromIndex: number, toIndex: number) {
    const prev = get().views
    const sorted = [...prev].sort((a, b) => a.sortOrder - b.sortOrder)
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= sorted.length || toIndex >= sorted.length) return
    const [moved] = sorted.splice(fromIndex, 1)
    sorted.splice(toIndex, 0, moved)
    const updated = sorted.map((v, i) => ({ ...v, sortOrder: i }))
    set({ views: updated })
    try {
      await db.transaction('rw', db.savedViews, async () => {
        for (const v of updated) {
          await savedViewRepository.update(v.id, { sortOrder: v.sortOrder })
        }
      })
    } catch (e) {
      console.error('Failed to reorder views:', e)
      set({ views: prev, error: 'Failed to reorder views' })
    }
  },

  setActiveViewId(id: number | null) {
    set({ activeViewId: id })
  },
}))
