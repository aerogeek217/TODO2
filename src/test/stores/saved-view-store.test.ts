import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useSavedViewStore, savedFiltersToRuntime } from '../../stores/saved-view-store'
import { Priority } from '../../models'
import type { FilterCriteria } from '../../stores/filter-store'

const defaultFilters: FilterCriteria = {
  priorities: null,
  completedFilter: 'incomplete',
  assignedFilter: 'unassigned',
  followupFilter: 'all',
  hardDeadlineOnly: false,
  personIds: null,
  personFilterMode: 'include-orgs',
  tagIds: null,
  orgIds: null,
  orgFilterMode: 'include-people',
  statusIds: null,
  searchText: '',
  dateField: 'due',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDue: false,
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSavedViewStore.setState({ views: [], activeViewId: null })
})

describe('useSavedViewStore', () => {
  describe('load', () => {
    it('load_withViewsInDB_fetchesAllViewsIntoState', async () => {
      await db.savedViews.add({ name: 'My View', sortBy: 'priority', filters: { priorities: null, showCompleted: false, showAssigned: false, starredOnly: false, hardDeadlineOnly: false, personIds: null, tagIds: null, orgIds: null, dateRangeIncludeNoDue: false }, sortOrder: 1 })

      await useSavedViewStore.getState().load()

      const { views } = useSavedViewStore.getState()
      expect(views).toHaveLength(1)
      expect(views[0].name).toBe('My View')
      expect(views[0].sortBy).toBe('priority')
    })

    it('load_withEmptyDB_setsEmptyViewsArray', async () => {
      await useSavedViewStore.getState().load()

      expect(useSavedViewStore.getState().views).toHaveLength(0)
    })
  })

  describe('saveCurrentView', () => {
    it('saveCurrentView_withBasicFilters_createsViewAndSetsActiveViewId', async () => {
      await useSavedViewStore.getState().saveCurrentView('Work', 'due', defaultFilters)

      const { views, activeViewId } = useSavedViewStore.getState()
      expect(views).toHaveLength(1)
      expect(views[0].name).toBe('Work')
      expect(views[0].sortBy).toBe('due')
      expect(activeViewId).toBe(views[0].id)
    })

    it('saveCurrentView_withSetFilters_serializesSetsToArrays', async () => {
      const filters: FilterCriteria = {
        ...defaultFilters,
        priorities: new Set([Priority.High, Priority.Medium]),
        personIds: new Set([1, 2]),
        tagIds: new Set([10]),
        orgIds: new Set([5]),
        completedFilter: 'all',
        followupFilter: 'followup',
        hardDeadlineOnly: true,
        assignedFilter: 'all',
        dateRangeIncludeNoDue: true,
      }

      await useSavedViewStore.getState().saveCurrentView('Complex', 'tag', filters)

      const { views } = useSavedViewStore.getState()
      const saved = views[0].filters
      expect(saved.priorities).toEqual(expect.arrayContaining([Priority.High, Priority.Medium]))
      expect(saved.personIds).toEqual(expect.arrayContaining([1, 2]))
      expect(saved.tagIds).toEqual([10])
      expect(saved.orgIds).toEqual([5])
      expect(saved.completedFilter).toBe('all')
      expect(saved.followupFilter).toBe('followup')
      expect(saved.hardDeadlineOnly).toBe(true)
      expect(saved.assignedFilter).toBe('all')
      expect(saved.dateRangeIncludeNoDue).toBe(true)
      // Backward compat booleans are also written
      expect(saved.showCompleted).toBe(true)
      expect(saved.starredOnly).toBe(true)
      expect(saved.showAssigned).toBe(true)
    })

    it('saveCurrentView_withNullSets_storesNullInFilters', async () => {
      await useSavedViewStore.getState().saveCurrentView('Minimal', 'priority', defaultFilters)

      const { views } = useSavedViewStore.getState()
      const saved = views[0].filters
      expect(saved.priorities).toBeNull()
      expect(saved.personIds).toBeNull()
      expect(saved.tagIds).toBeNull()
      expect(saved.orgIds).toBeNull()
    })

    it('saveCurrentView_withStatusIds_serializesSetToArray', async () => {
      const filters: FilterCriteria = {
        ...defaultFilters,
        statusIds: new Set([1, 2]),
      }

      await useSavedViewStore.getState().saveCurrentView('Status View', 'status', filters)

      const { views } = useSavedViewStore.getState()
      const saved = views[0].filters
      expect(saved.statusIds).toEqual(expect.arrayContaining([1, 2]))
    })

    it('saveCurrentView_withNullStatusIds_omitsStatusIdsField', async () => {
      await useSavedViewStore.getState().saveCurrentView('No Status', 'priority', defaultFilters)

      const { views } = useSavedViewStore.getState()
      const saved = views[0].filters
      expect(saved.statusIds).toBeUndefined()
    })

    it('saveCurrentView_withExistingViews_setsSortOrderIncrementally', async () => {
      await useSavedViewStore.getState().saveCurrentView('First', 'priority', defaultFilters)
      await useSavedViewStore.getState().saveCurrentView('Second', 'due', defaultFilters)
      await useSavedViewStore.getState().saveCurrentView('Third', 'people', defaultFilters)

      const { views } = useSavedViewStore.getState()
      const sortOrders = views.map((v) => v.sortOrder)
      expect(sortOrders[0]).toBeLessThan(sortOrders[1])
      expect(sortOrders[1]).toBeLessThan(sortOrders[2])
    })

    it('saveCurrentView_persistsViewToDatabase', async () => {
      await useSavedViewStore.getState().saveCurrentView('Persisted', 'project', defaultFilters)

      const rows = await db.savedViews.toArray()
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Persisted')
    })
  })

  describe('renameView', () => {
    it('renameView_withExistingView_updatesNameInStateAndDB', async () => {
      await useSavedViewStore.getState().saveCurrentView('Old Name', 'priority', defaultFilters)
      const id = useSavedViewStore.getState().views[0].id

      await useSavedViewStore.getState().renameView(id, 'New Name')

      expect(useSavedViewStore.getState().views[0].name).toBe('New Name')
      const row = await db.savedViews.get(id)
      expect(row!.name).toBe('New Name')
    })

    it('renameView_withMultipleViews_onlyRenamesTargetView', async () => {
      await useSavedViewStore.getState().saveCurrentView('View A', 'priority', defaultFilters)
      await useSavedViewStore.getState().saveCurrentView('View B', 'due', defaultFilters)
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
      await useSavedViewStore.getState().saveCurrentView('To Delete', 'priority', defaultFilters)
      const id = useSavedViewStore.getState().activeViewId!

      await useSavedViewStore.getState().removeView(id)

      const { views, activeViewId } = useSavedViewStore.getState()
      expect(views).toHaveLength(0)
      expect(activeViewId).toBeNull()
      const row = await db.savedViews.get(id)
      expect(row).toBeUndefined()
    })

    it('removeView_withDifferentActiveViewId_preservesActiveViewId', async () => {
      await useSavedViewStore.getState().saveCurrentView('View 1', 'priority', defaultFilters)
      await useSavedViewStore.getState().saveCurrentView('View 2', 'due', defaultFilters)
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

describe('savedFiltersToRuntime orgFilterMode roundtrip', () => {
  it('orgFilterMode direct-only survives save and restore roundtrip', async () => {
    const filters: FilterCriteria = {
      ...defaultFilters,
      orgFilterMode: 'direct-only',
      orgIds: new Set([5]),
    }

    await useSavedViewStore.getState().saveCurrentView('Org Test', 'priority', filters)

    const { views } = useSavedViewStore.getState()
    const saved = views[0].filters
    expect(saved.orgFilterMode).toBe('direct-only')

    const restored = savedFiltersToRuntime(saved)
    expect(restored.orgFilterMode).toBe('direct-only')
  })

  it('orgFilterMode include-people survives roundtrip', async () => {
    const filters: FilterCriteria = {
      ...defaultFilters,
      orgFilterMode: 'include-people',
    }

    await useSavedViewStore.getState().saveCurrentView('Default Org', 'priority', filters)

    const { views } = useSavedViewStore.getState()
    const restored = savedFiltersToRuntime(views[0].filters)
    expect(restored.orgFilterMode).toBe('include-people')
  })

  it('undefined orgFilterMode defaults to include-people on restore', () => {
    const saved = {
      priorities: null,
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showAssigned: false,
      starredOnly: false,
      hardDeadlineOnly: false,
      dateRangeIncludeNoDue: false,
      // orgFilterMode intentionally omitted
    }

    const result = savedFiltersToRuntime(saved)
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

    await useSavedViewStore.getState().saveCurrentView('Person Test', 'priority', filters)

    const { views } = useSavedViewStore.getState()
    const saved = views[0].filters
    expect(saved.personFilterMode).toBe('direct-only')

    const restored = savedFiltersToRuntime(saved)
    expect(restored.personFilterMode).toBe('direct-only')
  })

  it('personFilterMode include-orgs survives roundtrip', async () => {
    const filters: FilterCriteria = {
      ...defaultFilters,
      personFilterMode: 'include-orgs',
    }

    await useSavedViewStore.getState().saveCurrentView('Default Person', 'priority', filters)

    const { views } = useSavedViewStore.getState()
    const restored = savedFiltersToRuntime(views[0].filters)
    expect(restored.personFilterMode).toBe('include-orgs')
  })

  it('undefined personFilterMode defaults to include-orgs on restore', () => {
    const saved = {
      priorities: null,
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showAssigned: false,
      starredOnly: false,
      hardDeadlineOnly: false,
      dateRangeIncludeNoDue: false,
      // personFilterMode intentionally omitted
    }

    const result = savedFiltersToRuntime(saved)
    expect(result.personFilterMode).toBe('include-orgs')
  })
})

describe('savedFiltersToRuntime', () => {
  it('savedFiltersToRuntime_withArrayValues_convertsArraysToSets', () => {
    const saved = {
      priorities: [Priority.High, Priority.Medium],
      personIds: [1, 2, 3],
      tagIds: [10, 20],
      orgIds: [5],
      completedFilter: 'all',
      assignedFilter: 'all',
      followupFilter: 'followup',
      showCompleted: true,
      showAssigned: true,
      starredOnly: true,
      hardDeadlineOnly: true,
      dateRangeIncludeNoDue: true,
    }

    const result = savedFiltersToRuntime(saved)

    expect(result.priorities).toEqual(new Set([Priority.High, Priority.Medium]))
    expect(result.personIds).toEqual(new Set([1, 2, 3]))
    expect(result.tagIds).toEqual(new Set([10, 20]))
    expect(result.orgIds).toEqual(new Set([5]))
    expect(result.completedFilter).toBe('all')
    expect(result.assignedFilter).toBe('all')
    expect(result.followupFilter).toBe('followup')
  })

  it('savedFiltersToRuntime_withNullArrays_preservesNulls', () => {
    const saved = {
      priorities: null,
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showAssigned: false,
      starredOnly: false,
      hardDeadlineOnly: false,
      dateRangeIncludeNoDue: false,
    }

    const result = savedFiltersToRuntime(saved)

    expect(result.priorities).toBeNull()
    expect(result.personIds).toBeNull()
    expect(result.tagIds).toBeNull()
    expect(result.orgIds).toBeNull()
  })

  it('savedFiltersToRuntime_withAnyInput_resetsTransientFields', () => {
    const saved = {
      priorities: null,
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showAssigned: false,
      starredOnly: false,
      hardDeadlineOnly: false,
      dateRangeIncludeNoDue: false,
    }

    const result = savedFiltersToRuntime(saved)

    expect(result.searchText).toBe('')
    expect(result.dateRangeStart).toBeNull()
    expect(result.dateRangeEnd).toBeNull()
  })

  it('savedFiltersToRuntime_withOldBooleans_convertsToNewFilterTypes', () => {
    const saved = {
      priorities: null,
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: true,
      showAssigned: true,
      starredOnly: true,
      hardDeadlineOnly: true,
      dateRangeIncludeNoDue: true,
    }

    const result = savedFiltersToRuntime(saved)

    expect(result.completedFilter).toBe('all')
    expect(result.assignedFilter).toBe('all')
    expect(result.followupFilter).toBe('followup')
    expect(result.hardDeadlineOnly).toBe(true)
    expect(result.dateRangeIncludeNoDue).toBe(true)
  })

  it('savedFiltersToRuntime_withNewStringFields_prefersNewOverOld', () => {
    const saved = {
      priorities: null,
      personIds: null,
      tagIds: null,
      orgIds: null,
      completedFilter: 'completed',
      assignedFilter: 'assigned',
      followupFilter: 'no-followup',
      showCompleted: false,
      showAssigned: false,
      starredOnly: false,
      hardDeadlineOnly: false,
      dateRangeIncludeNoDue: false,
    }

    const result = savedFiltersToRuntime(saved)

    expect(result.completedFilter).toBe('completed')
    expect(result.assignedFilter).toBe('assigned')
    expect(result.followupFilter).toBe('no-followup')
  })

  it('savedFiltersToRuntime_withStatusIds_convertsArrayToSet', () => {
    const saved = {
      priorities: null,
      personIds: null,
      tagIds: null,
      orgIds: null,
      statusIds: [1, 2, 3],
      showCompleted: false,
      showAssigned: false,
      starredOnly: false,
      hardDeadlineOnly: false,
      dateRangeIncludeNoDue: false,
    }

    const result = savedFiltersToRuntime(saved)
    expect(result.statusIds).toEqual(new Set([1, 2, 3]))
  })

  it('savedFiltersToRuntime_withNoStatusIds_returnsNull', () => {
    const saved = {
      priorities: null,
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showAssigned: false,
      starredOnly: false,
      hardDeadlineOnly: false,
      dateRangeIncludeNoDue: false,
    }

    const result = savedFiltersToRuntime(saved)
    expect(result.statusIds).toBeNull()
  })

  it('savedFiltersToRuntime_withDateField_preservesDateField', () => {
    const saved = {
      priorities: null,
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showAssigned: false,
      starredOnly: false,
      hardDeadlineOnly: false,
      dateField: 'modified' as const,
      dateRangeIncludeNoDue: false,
    }

    const result = savedFiltersToRuntime(saved)
    expect(result.dateField).toBe('modified')
  })

  it('savedFiltersToRuntime_withoutDateField_defaultsToDue', () => {
    const saved = {
      priorities: null,
      personIds: null,
      tagIds: null,
      orgIds: null,
      showCompleted: false,
      showAssigned: false,
      starredOnly: false,
      hardDeadlineOnly: false,
      dateRangeIncludeNoDue: false,
    }

    const result = savedFiltersToRuntime(saved)
    expect(result.dateField).toBe('due')
  })
})
