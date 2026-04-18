import { create } from 'zustand'
import { savedViewRepository } from '../data/saved-view-repository'
import { db } from '../data/database'
import type {
  PersistedSavedView,
  SavedView,
  SavedViewFilters,
  ListSortBy,
  ListGroupBy,
  ListItemSortBy,
  DateField,
  Status,
} from '../models'
import type { FilterCriteria } from './filter-store'

/**
 * Translate a persisted saved-view sortBy value into the current ListSortBy.
 * - 'priority' → 'date' (Q12). Silent; effectiveDate makes this meaningful.
 * - 'due' → 'date' (Q11). Rename from Phase 2.
 * Unknown values fall back to 'date'.
 */
export function translateSortBy(sortBy: string): ListSortBy {
  if (sortBy === 'priority' || sortBy === 'due') return 'date'
  if (sortBy === 'date' || sortBy === 'scheduled' || sortBy === 'deadline'
      || sortBy === 'people' || sortBy === 'tag'
      || sortBy === 'project' || sortBy === 'org' || sortBy === 'status') {
    return sortBy
  }
  return 'date'
}

/**
 * Resolve the grouping + within-group sort from a persisted saved view,
 * falling back to the legacy single `sortBy` field for views saved before
 * group/sort were split.
 */
export function resolveSavedViewGrouping(v: { sortBy: string; groupBy?: ListGroupBy; itemSortBy?: ListItemSortBy }): {
  groupBy: ListGroupBy
  itemSortBy: ListItemSortBy
} {
  const groupBy: ListGroupBy = v.groupBy ?? translateSortBy(v.sortBy)
  const itemSortBy: ListItemSortBy = v.itemSortBy ?? 'manual'
  return { groupBy, itemSortBy }
}

/** Narrow a `ListGroupBy` to the legacy `ListSortBy` field written on save. */
function legacySortBy(groupBy: ListGroupBy): ListSortBy {
  return groupBy === 'none' ? 'date' : groupBy
}

export interface ViewLimit {
  maxTasks?: number
  limitMode?: 'hard' | 'scroll'
}

interface SavedViewState {
  views: PersistedSavedView[]
  activeViewId: number | null
  loading: boolean
  error: string | null

  load: () => Promise<void>
  saveCurrentView: (
    name: string,
    groupBy: ListGroupBy,
    itemSortBy: ListItemSortBy,
    filters: FilterCriteria,
    limit?: ViewLimit,
  ) => Promise<void>
  updateView: (
    id: number,
    groupBy: ListGroupBy,
    itemSortBy: ListItemSortBy,
    filters: FilterCriteria,
    limit?: ViewLimit,
  ) => Promise<void>
  renameView: (id: number, name: string) => Promise<void>
  removeView: (id: number) => Promise<void>
  reorder: (fromIndex: number, toIndex: number) => Promise<void>
  setActiveViewId: (id: number | null) => void
}

function buildViewFields(
  groupBy: ListGroupBy,
  itemSortBy: ListItemSortBy,
  filters: FilterCriteria,
  limit?: ViewLimit,
): Pick<SavedView, 'sortBy' | 'groupBy' | 'itemSortBy' | 'filters' | 'maxTasks' | 'limitMode'> {
  return {
    sortBy: legacySortBy(groupBy),
    groupBy,
    itemSortBy,
    filters: filtersToSerializable(filters),
    ...(limit?.maxTasks != null ? { maxTasks: limit.maxTasks } : {}),
    ...(limit?.limitMode != null ? { limitMode: limit.limitMode } : {}),
  }
}

function filtersToSerializable(f: FilterCriteria): SavedViewFilters {
  return {
    showCompleted: f.showCompleted,
    showHiddenStatuses: f.showHiddenStatuses,
    personIds: f.personIds ? Array.from(f.personIds) : null,
    personFilterMode: f.personFilterMode,
    tagIds: f.tagIds ? Array.from(f.tagIds) : null,
    orgIds: f.orgIds ? Array.from(f.orgIds) : null,
    orgFilterMode: f.orgFilterMode,
    ...(f.statusIds != null ? { statusIds: Array.from(f.statusIds) } : {}),
    dateField: f.dateField,
    dateRangeStart: f.dateRangeStart ? f.dateRangeStart.toISOString() : null,
    dateRangeEnd: f.dateRangeEnd ? f.dateRangeEnd.toISOString() : null,
    dateRangeIncludeNoDate: f.dateRangeIncludeNoDate,
  }
}

export function savedFiltersToRuntime(
  s: SavedViewFilters,
  seededAssignedId: number | null = null,
  seededFollowupId: number | null = null,
  allStatuses: Status[] = [],
): { runtime: Partial<FilterCriteria>; losses: string[] } {
  const losses: string[] = []
  const hasLegacyFormat = s.completedFilter !== undefined || s.assignedFilter !== undefined || s.followupFilter !== undefined || s.starredOnly !== undefined

  let showCompleted: boolean
  let showHiddenStatuses: boolean
  let statusIds: Set<number> | null = s.statusIds ? new Set(s.statusIds) : null

  if (hasLegacyFormat) {
    // Completed filter translation
    const cf = s.completedFilter as string | undefined
    showCompleted = cf === 'all' || cf === 'completed' || (cf === undefined && s.showCompleted === true)

    // Assigned filter translation
    const af = s.assignedFilter as string | undefined
    showHiddenStatuses = false
    if (af === 'all') {
      showHiddenStatuses = true
    } else if (af === 'assigned') {
      if (seededAssignedId != null) {
        statusIds = new Set([seededAssignedId])
        showHiddenStatuses = true
      } else {
        losses.push("'assigned' filter: seeded Assigned status was deleted")
      }
    } else if (af === 'unassigned') {
      if (seededAssignedId != null) {
        const inverseIds = allStatuses.filter(st => st.id != null && st.id !== seededAssignedId).map(st => st.id!)
        statusIds = new Set([...inverseIds, 0])
      } else {
        losses.push("'unassigned' filter: seeded Assigned status was deleted")
      }
    }
    // af === 'unassigned-only' or undefined or showAssigned===false → defaults (statusIds=null, showHiddenStatuses=false)

    // Follow-up / starredOnly filter translation (may further constrain statusIds)
    const ff = s.followupFilter as string | undefined
    const isStarredFilter = ff === 'followup' || s.starredOnly === true
    const isNoFollowupFilter = ff === 'no-followup'

    if (isStarredFilter) {
      if (seededFollowupId != null) {
        statusIds = new Set([seededFollowupId])
      } else {
        losses.push("'followup' filter: seeded Follow-up status was deleted")
      }
    } else if (isNoFollowupFilter) {
      if (seededFollowupId != null) {
        const inverseIds = allStatuses.filter(st => st.id != null && st.id !== seededFollowupId).map(st => st.id!)
        statusIds = new Set([...inverseIds, 0])
      } else {
        losses.push("'no-followup' filter: seeded Follow-up status was deleted")
      }
    }
  } else {
    showCompleted = s.showCompleted ?? false
    showHiddenStatuses = s.showHiddenStatuses ?? false
  }

  // v20→v21 translation — silent per Q13 (no losses pushed).
  //
  // (a) dateField: 'due' → 'date'. Stored value 'due' predates Phase 2's rename.
  //     Undefined defaults to 'date'. 'scheduled' / 'deadline' pass through (v22+).
  const dateFieldRaw = s.dateField as string | undefined
  const dateField: DateField =
    dateFieldRaw === 'created' ? 'created'
    : dateFieldRaw === 'modified' ? 'modified'
    : dateFieldRaw === 'scheduled' ? 'scheduled'
    : dateFieldRaw === 'deadline' ? 'deadline'
    : 'date'

  // (b) dateRangeIncludeNoDue → dateRangeIncludeNoDate. Read either key.
  const dateRangeIncludeNoDate = typeof s.dateRangeIncludeNoDate === 'boolean'
    ? s.dateRangeIncludeNoDate
    : typeof s.dateRangeIncludeNoDue === 'boolean'
      ? s.dateRangeIncludeNoDue
      : false

  // (c) priorities, (d) hardDeadlineOnly: dropped. Filter interface no longer carries them.

  return {
    runtime: {
      showCompleted,
      showHiddenStatuses,
      personIds: s.personIds ? new Set(s.personIds) : null,
      personFilterMode: s.personFilterMode === 'direct-only' ? 'direct-only' : 'include-orgs',
      tagIds: s.tagIds ? new Set(s.tagIds) : null,
      orgIds: s.orgIds ? new Set(s.orgIds) : null,
      orgFilterMode: s.orgFilterMode === 'direct-only' ? 'direct-only' : 'include-people',
      statusIds,
      dateField,
      dateRangeStart: s.dateRangeStart ? new Date(s.dateRangeStart) : null,
      dateRangeEnd: s.dateRangeEnd ? new Date(s.dateRangeEnd) : null,
      dateRangeIncludeNoDate,
      searchText: '',
    },
    losses,
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

  async saveCurrentView(name: string, groupBy: ListGroupBy, itemSortBy: ListItemSortBy, filters: FilterCriteria, limit?: ViewLimit) {
    try {
      const { views } = get()
      const maxSort = views.length > 0 ? Math.max(...views.map((v) => v.sortOrder)) : 0
      const fields = buildViewFields(groupBy, itemSortBy, filters, limit)
      const id = await savedViewRepository.add({
        name,
        ...fields,
        sortOrder: maxSort + 1,
      })
      set({ views: [...views, { id, name, ...fields, sortOrder: maxSort + 1 }], activeViewId: id })
    } catch (e) {
      console.error('Failed to save view:', e)
      set({ error: 'Failed to save view' })
    }
  },

  async updateView(id: number, groupBy: ListGroupBy, itemSortBy: ListItemSortBy, filters: FilterCriteria, limit?: ViewLimit) {
    try {
      const fields = buildViewFields(groupBy, itemSortBy, filters, limit)
      // Passing `undefined` explicitly ensures cleared caps actually overwrite the stored value.
      const patch = {
        ...fields,
        maxTasks: limit?.maxTasks,
        limitMode: limit?.limitMode,
      }
      await savedViewRepository.update(id, patch)
      set({ views: get().views.map((v) => (v.id === id ? { ...v, ...patch } : v)), activeViewId: id })
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
