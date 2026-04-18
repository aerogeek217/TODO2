import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useSavedViewStore, savedFiltersToRuntime, resolveSavedViewGrouping } from '../../stores/saved-view-store'
import type { FilterCriteria } from '../../stores/filter-store'

const defaultFilters: FilterCriteria = {
  showCompleted: false,
  showHiddenStatuses: false,
  personIds: null,
  personFilterMode: 'include-orgs',
  tagIds: null,
  orgIds: null,
  orgFilterMode: 'include-people',
  statusIds: null,
  searchText: '',
  dateField: 'date',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSavedViewStore.setState({ views: [], activeViewId: null })
})

describe('useSavedViewStore', () => {
  describe('load', () => {
    it('load_withViewsInDB_fetchesAllViewsIntoState', async () => {
      await db.savedViews.add({
        name: 'My View',
        sortBy: 'date',
        filters: {
          showCompleted: false,
          showHiddenStatuses: false,
          personIds: null,
          tagIds: null,
          orgIds: null,
          dateRangeIncludeNoDate: false,
        },
        sortOrder: 1,
      })

      await useSavedViewStore.getState().load()

      const { views } = useSavedViewStore.getState()
      expect(views).toHaveLength(1)
      expect(views[0].name).toBe('My View')
      expect(views[0].sortBy).toBe('date')
    })

    it('load_withEmptyDB_setsEmptyViewsArray', async () => {
      await useSavedViewStore.getState().load()

      expect(useSavedViewStore.getState().views).toHaveLength(0)
    })
  })

  describe('saveCurrentView', () => {
    it('saveCurrentView_withBasicFilters_createsViewAndSetsActiveViewId', async () => {
      await useSavedViewStore.getState().saveCurrentView('Work', 'date', 'manual', defaultFilters)

      const { views, activeViewId } = useSavedViewStore.getState()
      expect(views).toHaveLength(1)
      expect(views[0].name).toBe('Work')
      expect(views[0].sortBy).toBe('date')
      expect(activeViewId).toBe(views[0].id)
    })

    it('saveCurrentView_withSetFilters_serializesSetsToArrays', async () => {
      const filters: FilterCriteria = {
        ...defaultFilters,
        personIds: new Set([1, 2]),
        tagIds: new Set([10]),
        orgIds: new Set([5]),
        showCompleted: true,
        showHiddenStatuses: true,
        dateRangeIncludeNoDate: true,
      }

      await useSavedViewStore.getState().saveCurrentView('Complex', 'tag', 'manual', filters)

      const { views } = useSavedViewStore.getState()
      const saved = views[0].filters
      expect(saved.personIds).toEqual(expect.arrayContaining([1, 2]))
      expect(saved.tagIds).toEqual([10])
      expect(saved.orgIds).toEqual([5])
      expect(saved.showCompleted).toBe(true)
      expect(saved.showHiddenStatuses).toBe(true)
      expect(saved.dateRangeIncludeNoDate).toBe(true)
    })

    it('saveCurrentView_withNullSets_storesNullInFilters', async () => {
      await useSavedViewStore.getState().saveCurrentView('Minimal', 'date', 'manual', defaultFilters)

      const { views } = useSavedViewStore.getState()
      const saved = views[0].filters
      expect(saved.personIds).toBeNull()
      expect(saved.tagIds).toBeNull()
      expect(saved.orgIds).toBeNull()
    })

    it('saveCurrentView_withStatusIds_serializesSetToArray', async () => {
      const filters: FilterCriteria = {
        ...defaultFilters,
        statusIds: new Set([1, 2]),
      }

      await useSavedViewStore.getState().saveCurrentView('Status View', 'status', 'manual', filters)

      const { views } = useSavedViewStore.getState()
      const saved = views[0].filters
      expect(saved.statusIds).toEqual(expect.arrayContaining([1, 2]))
    })

    it('saveCurrentView_withNullStatusIds_omitsStatusIdsField', async () => {
      await useSavedViewStore.getState().saveCurrentView('No Status', 'date', 'manual', defaultFilters)

      const { views } = useSavedViewStore.getState()
      const saved = views[0].filters
      expect(saved.statusIds).toBeUndefined()
    })

    it('saveCurrentView_withExistingViews_setsSortOrderIncrementally', async () => {
      await useSavedViewStore.getState().saveCurrentView('First', 'date', 'manual', defaultFilters)
      await useSavedViewStore.getState().saveCurrentView('Second', 'date', 'manual', defaultFilters)
      await useSavedViewStore.getState().saveCurrentView('Third', 'people', 'manual', defaultFilters)

      const { views } = useSavedViewStore.getState()
      const sortOrders = views.map((v) => v.sortOrder)
      expect(sortOrders[0]).toBeLessThan(sortOrders[1])
      expect(sortOrders[1]).toBeLessThan(sortOrders[2])
    })

    it('saveCurrentView_persistsViewToDatabase', async () => {
      await useSavedViewStore.getState().saveCurrentView('Persisted', 'project', 'manual', defaultFilters)

      const rows = await db.savedViews.toArray()
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Persisted')
    })
  })

  describe('renameView', () => {
    it('renameView_withExistingView_updatesNameInStateAndDB', async () => {
      await useSavedViewStore.getState().saveCurrentView('Old Name', 'date', 'manual', defaultFilters)
      const id = useSavedViewStore.getState().views[0].id

      await useSavedViewStore.getState().renameView(id, 'New Name')

      expect(useSavedViewStore.getState().views[0].name).toBe('New Name')
      const row = await db.savedViews.get(id)
      expect(row!.name).toBe('New Name')
    })

    it('renameView_withMultipleViews_onlyRenamesTargetView', async () => {
      await useSavedViewStore.getState().saveCurrentView('View A', 'date', 'manual', defaultFilters)
      await useSavedViewStore.getState().saveCurrentView('View B', 'date', 'manual', defaultFilters)
      const { views } = useSavedViewStore.getState()
      const idA = views[0].id

      await useSavedViewStore.getState().renameView(idA, 'View A Renamed')

      const updated = useSavedViewStore.getState().views
      expect(updated.find((v) => v.id === idA)!.name).toBe('View A Renamed')
      expect(updated.find((v) => v.id !== idA)!.name).toBe('View B')
    })
  })

  describe('removeView', () => {
    it('removeView_withMatchingActiveViewId_deletesViewAndClearsActiveViewId', async () => {
      await useSavedViewStore.getState().saveCurrentView('To Delete', 'date', 'manual', defaultFilters)
      const id = useSavedViewStore.getState().activeViewId!

      await useSavedViewStore.getState().removeView(id)

      const { views, activeViewId } = useSavedViewStore.getState()
      expect(views).toHaveLength(0)
      expect(activeViewId).toBeNull()
      const row = await db.savedViews.get(id)
      expect(row).toBeUndefined()
    })

    it('removeView_withDifferentActiveViewId_preservesActiveViewId', async () => {
      await useSavedViewStore.getState().saveCurrentView('View 1', 'date', 'manual', defaultFilters)
      await useSavedViewStore.getState().saveCurrentView('View 2', 'date', 'manual', defaultFilters)
      const { views } = useSavedViewStore.getState()
      const idToKeep = views[0].id
      const idToRemove = views[1].id
      useSavedViewStore.setState({ activeViewId: idToKeep })

      await useSavedViewStore.getState().removeView(idToRemove)

      expect(useSavedViewStore.getState().activeViewId).toBe(idToKeep)
      expect(useSavedViewStore.getState().views).toHaveLength(1)
    })
  })

  describe('setActiveViewId', () => {
    it('setActiveViewId_withValidId_updatesActiveViewId', () => {
      useSavedViewStore.getState().setActiveViewId(42)

      expect(useSavedViewStore.getState().activeViewId).toBe(42)
    })

    it('setActiveViewId_withNull_clearsActiveViewId', () => {
      useSavedViewStore.setState({ activeViewId: 42 })

      useSavedViewStore.getState().setActiveViewId(null)

      expect(useSavedViewStore.getState().activeViewId).toBeNull()
    })
  })
})

describe('resolveSavedViewGrouping (split group + sort)', () => {
  it('reads modern saves directly', () => {
    expect(resolveSavedViewGrouping({ sortBy: 'date', groupBy: 'tag', itemSortBy: 'deadline' }))
      .toEqual({ groupBy: 'tag', itemSortBy: 'deadline' })
  })

  it('falls back to legacy sortBy as groupBy when groupBy is absent', () => {
    expect(resolveSavedViewGrouping({ sortBy: 'project' }))
      .toEqual({ groupBy: 'project', itemSortBy: 'manual' })
  })

  it('translates legacy priority/due sortBy to date', () => {
    expect(resolveSavedViewGrouping({ sortBy: 'priority' }).groupBy).toBe('date')
    expect(resolveSavedViewGrouping({ sortBy: 'due' }).groupBy).toBe('date')
  })

  it('round-trips through saveCurrentView — groupBy=none is preserved', async () => {
    await useSavedViewStore.getState().saveCurrentView('Flat', 'none', 'date', defaultFilters)
    const saved = useSavedViewStore.getState().views[0]
    expect(saved.groupBy).toBe('none')
    expect(saved.itemSortBy).toBe('date')
    // Legacy field defaults to 'date' so pre-split clients still get something sane.
    expect(saved.sortBy).toBe('date')
    expect(resolveSavedViewGrouping(saved)).toEqual({ groupBy: 'none', itemSortBy: 'date' })
  })
})

describe('savedFiltersToRuntime orgFilterMode roundtrip', () => {
  it('orgFilterMode direct-only survives save and restore roundtrip', async () => {
    const filters: FilterCriteria = {
      ...defaultFilters,
      orgFilterMode: 'direct-only',
      orgIds: new Set([5]),
    }

    await useSavedViewStore.getState().saveCurrentView('Org Test', 'date', 'manual', filters)

    const { views } = useSavedViewStore.getState()
    const saved = views[0].filters
    expect(saved.orgFilterMode).toBe('direct-only')

    const { runtime: restored } = savedFiltersToRuntime(saved)
    expect(restored.orgFilterMode).toBe('direct-only')
  })

  it('orgFilterMode include-people survives roundtrip', async () => {
    const filters: FilterCriteria = {
      ...defaultFilters,
      orgFilterMode: 'include-people',
    }

    await useSavedViewStore.getState().saveCurrentView('Default Org', 'date', 'manual', filters)

    const { views } = useSavedViewStore.getState()
    const { runtime: restored } = savedFiltersToRuntime(views[0].filters)
    expect(restored.orgFilterMode).toBe('include-people')
  })

  it('undefined orgFilterMode defaults to include-people on restore', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showHiddenStatuses: false,
      dateRangeIncludeNoDate: false,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)
    expect(result.orgFilterMode).toBe('include-people')
  })
})

describe('savedFiltersToRuntime personFilterMode roundtrip', () => {
  it('personFilterMode direct-only survives save and restore roundtrip', async () => {
    const filters: FilterCriteria = {
      ...defaultFilters,
      personFilterMode: 'direct-only',
      personIds: new Set([5]),
    }

    await useSavedViewStore.getState().saveCurrentView('Person Test', 'date', 'manual', filters)

    const { views } = useSavedViewStore.getState()
    const saved = views[0].filters
    expect(saved.personFilterMode).toBe('direct-only')

    const { runtime: restored } = savedFiltersToRuntime(saved)
    expect(restored.personFilterMode).toBe('direct-only')
  })

  it('personFilterMode include-orgs survives roundtrip', async () => {
    const filters: FilterCriteria = {
      ...defaultFilters,
      personFilterMode: 'include-orgs',
    }

    await useSavedViewStore.getState().saveCurrentView('Default Person', 'date', 'manual', filters)

    const { views } = useSavedViewStore.getState()
    const { runtime: restored } = savedFiltersToRuntime(views[0].filters)
    expect(restored.personFilterMode).toBe('include-orgs')
  })

  it('undefined personFilterMode defaults to include-orgs on restore', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showHiddenStatuses: false,
      dateRangeIncludeNoDate: false,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)
    expect(result.personFilterMode).toBe('include-orgs')
  })
})

describe('savedFiltersToRuntime', () => {
  it('savedFiltersToRuntime_withArrayValues_convertsArraysToSets', () => {
    const saved = {
      personIds: [1, 2, 3],
      tagIds: [10, 20],
      orgIds: [5],
      showCompleted: true,
      showHiddenStatuses: true,
      dateRangeIncludeNoDate: true,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)

    expect(result.personIds).toEqual(new Set([1, 2, 3]))
    expect(result.tagIds).toEqual(new Set([10, 20]))
    expect(result.orgIds).toEqual(new Set([5]))
    expect(result.showCompleted).toBe(true)
    expect(result.showHiddenStatuses).toBe(true)
  })

  it('savedFiltersToRuntime_withNullArrays_preservesNulls', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showHiddenStatuses: false,
      dateRangeIncludeNoDate: false,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)

    expect(result.personIds).toBeNull()
    expect(result.tagIds).toBeNull()
    expect(result.orgIds).toBeNull()
  })

  it('savedFiltersToRuntime_withAnyInput_resetsTransientFields', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showHiddenStatuses: false,
      dateRangeIncludeNoDate: false,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)

    expect(result.searchText).toBe('')
    expect(result.dateRangeStart).toBeNull()
    expect(result.dateRangeEnd).toBeNull()
  })

  it('savedFiltersToRuntime_withLegacyCompletedFilter_derivesShowCompleted', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      completedFilter: 'all',
      assignedFilter: 'all',
      showCompleted: false,
      showHiddenStatuses: false,
      dateRangeIncludeNoDate: true,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)

    expect(result.showCompleted).toBe(true)
    expect(result.showHiddenStatuses).toBe(true)
    expect(result.dateRangeIncludeNoDate).toBe(true)
  })

  it('savedFiltersToRuntime_withLegacyIncompleteFilter_derivesShowCompletedFalse', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      completedFilter: 'incomplete',
      assignedFilter: 'unassigned',
      showCompleted: false,
      showHiddenStatuses: false,
      dateRangeIncludeNoDate: false,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)

    expect(result.showCompleted).toBe(false)
    expect(result.showHiddenStatuses).toBe(false)
  })

  it('savedFiltersToRuntime_withStatusIds_convertsArrayToSet', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      statusIds: [1, 2, 3],
      showCompleted: false,
      showHiddenStatuses: false,
      dateRangeIncludeNoDate: false,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)
    expect(result.statusIds).toEqual(new Set([1, 2, 3]))
  })

  it('savedFiltersToRuntime_withNoStatusIds_returnsNull', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showHiddenStatuses: false,
      dateRangeIncludeNoDate: false,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)
    expect(result.statusIds).toBeNull()
  })

  it('savedFiltersToRuntime_withDateField_preservesDateField', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showHiddenStatuses: false,
      dateField: 'modified' as const,
      dateRangeIncludeNoDate: false,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)
    expect(result.dateField).toBe('modified')
  })

  it('savedFiltersToRuntime_withoutDateField_defaultsToDate', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showHiddenStatuses: false,
      dateRangeIncludeNoDate: false,
    }

    const { runtime: result } = savedFiltersToRuntime(saved)
    expect(result.dateField).toBe('date')
  })

  it('legacy dateField=due translates to date', () => {
    const saved = {
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showHiddenStatuses: false,
      dateField: 'due',
      dateRangeIncludeNoDue: true,
    } as any

    const { runtime: result } = savedFiltersToRuntime(saved)
    expect(result.dateField).toBe('date')
    expect(result.dateRangeIncludeNoDate).toBe(true)
  })
})

describe('savedFiltersToRuntime legacy translation with seeded IDs', () => {
  const FOLLOWUP_ID = 100
  const ASSIGNED_ID = 101
  const allStatuses = [
    { id: FOLLOWUP_ID, name: 'Follow-up', color: '#F5A623', sortOrder: 0 },
    { id: ASSIGNED_ID, name: 'Assigned', color: '#537FE7', sortOrder: 1 },
    { id: 200, name: 'In Progress', color: '#00ff00', sortOrder: 2 },
  ]

  const baseSaved = {
    personIds: null,
    tagIds: null,
    orgIds: null,
    showCompleted: false,
    showHiddenStatuses: false,
    dateRangeIncludeNoDate: false,
  }

  it('starredOnly=true translates to followup statusId', () => {
    const { runtime, losses } = savedFiltersToRuntime(
      { ...baseSaved, starredOnly: true },
      ASSIGNED_ID, FOLLOWUP_ID, allStatuses,
    )
    expect(runtime.statusIds).toEqual(new Set([FOLLOWUP_ID]))
    expect(losses).toHaveLength(0)
  })

  it('followupFilter=followup translates to followup statusId', () => {
    const { runtime } = savedFiltersToRuntime(
      { ...baseSaved, followupFilter: 'followup' },
      ASSIGNED_ID, FOLLOWUP_ID, allStatuses,
    )
    expect(runtime.statusIds).toEqual(new Set([FOLLOWUP_ID]))
  })

  it('assignedFilter=assigned translates to assigned statusId + showHiddenStatuses', () => {
    const { runtime } = savedFiltersToRuntime(
      { ...baseSaved, assignedFilter: 'assigned' },
      ASSIGNED_ID, FOLLOWUP_ID, allStatuses,
    )
    expect(runtime.statusIds).toEqual(new Set([ASSIGNED_ID]))
    expect(runtime.showHiddenStatuses).toBe(true)
  })

  it('assignedFilter=unassigned builds inverse set excluding assigned', () => {
    const { runtime } = savedFiltersToRuntime(
      { ...baseSaved, assignedFilter: 'unassigned' },
      ASSIGNED_ID, FOLLOWUP_ID, allStatuses,
    )
    expect(runtime.statusIds).toEqual(new Set([FOLLOWUP_ID, 200, 0]))
    expect(runtime.statusIds!.has(ASSIGNED_ID)).toBe(false)
  })

  it('followupFilter=no-followup builds inverse set excluding followup', () => {
    const { runtime } = savedFiltersToRuntime(
      { ...baseSaved, followupFilter: 'no-followup' },
      ASSIGNED_ID, FOLLOWUP_ID, allStatuses,
    )
    expect(runtime.statusIds).toEqual(new Set([ASSIGNED_ID, 200, 0]))
    expect(runtime.statusIds!.has(FOLLOWUP_ID)).toBe(false)
  })

  it('null seeded IDs produce losses for followup filter', () => {
    const { runtime, losses } = savedFiltersToRuntime(
      { ...baseSaved, followupFilter: 'followup' },
      null, null, allStatuses,
    )
    expect(losses).toHaveLength(1)
    expect(losses[0]).toContain('Follow-up status was deleted')
    expect(runtime.statusIds).toBeNull()
  })

  it('null seeded IDs produce losses for assigned filter', () => {
    const { losses } = savedFiltersToRuntime(
      { ...baseSaved, assignedFilter: 'assigned' },
      null, FOLLOWUP_ID, allStatuses,
    )
    expect(losses).toHaveLength(1)
    expect(losses[0]).toContain('Assigned status was deleted')
  })

  it('v20 saved view (no legacy fields) passes through unchanged', () => {
    const { runtime, losses } = savedFiltersToRuntime(
      { ...baseSaved, showCompleted: true, showHiddenStatuses: true, statusIds: [1, 2] },
      ASSIGNED_ID, FOLLOWUP_ID, allStatuses,
    )
    expect(runtime.showCompleted).toBe(true)
    expect(runtime.showHiddenStatuses).toBe(true)
    expect(runtime.statusIds).toEqual(new Set([1, 2]))
    expect(losses).toHaveLength(0)
  })

  it('completedFilter=all translates to showCompleted=true', () => {
    const { runtime } = savedFiltersToRuntime(
      { ...baseSaved, completedFilter: 'all' },
      ASSIGNED_ID, FOLLOWUP_ID, allStatuses,
    )
    expect(runtime.showCompleted).toBe(true)
  })

  it('completedFilter=incomplete translates to showCompleted=false', () => {
    const { runtime } = savedFiltersToRuntime(
      { ...baseSaved, completedFilter: 'incomplete' },
      ASSIGNED_ID, FOLLOWUP_ID, allStatuses,
    )
    expect(runtime.showCompleted).toBe(false)
  })

  it('assignedFilter=unassigned-only maps to defaults', () => {
    const { runtime } = savedFiltersToRuntime(
      { ...baseSaved, assignedFilter: 'unassigned-only' },
      ASSIGNED_ID, FOLLOWUP_ID, allStatuses,
    )
    expect(runtime.statusIds).toBeNull()
    expect(runtime.showHiddenStatuses).toBe(false)
  })

  it('filtersToSerializable writes only new fields', async () => {
    const filters: FilterCriteria = {
      ...defaultFilters,
      showCompleted: true,
      showHiddenStatuses: true,
    }
    await useSavedViewStore.getState().saveCurrentView('V20 View', 'date', 'manual', filters)
    const { views } = useSavedViewStore.getState()
    const saved = views[0].filters
    expect(saved.showCompleted).toBe(true)
    expect(saved.showHiddenStatuses).toBe(true)
    expect(saved.completedFilter).toBeUndefined()
    expect(saved.assignedFilter).toBeUndefined()
    expect(saved.followupFilter).toBeUndefined()
    expect(saved.starredOnly).toBeUndefined()
  })
})
