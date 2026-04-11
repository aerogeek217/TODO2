import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { savedViewRepository } from '../../data/saved-view-repository'
import type { SavedView } from '../../models'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('savedViewRepository', () => {
  function makeView(overrides: Partial<SavedView> = {}): SavedView {
    return {
      name: 'My View',
      sortBy: 'priority',
      sortOrder: 0,
      filters: {
        priorities: null,
        showCompleted: false,
        showAssigned: false,
        starredOnly: false,
        hardDeadlineOnly: false,
        personIds: null,
        tagIds: null,
        orgIds: null,
        dateRangeIncludeNoDue: false,
      },
      ...overrides,
    }
  }

  it('getAll_emptyDatabase_returnsEmptyArray', async () => {
    const views = await savedViewRepository.getAll()
    expect(views).toHaveLength(0)
  })

  it('add_andGetAll_returnsInsertedView', async () => {
    await savedViewRepository.add(makeView({ name: 'Work', sortBy: 'due' }))
    const views = await savedViewRepository.getAll()
    expect(views).toHaveLength(1)
    expect(views[0].name).toBe('Work')
    expect(views[0].sortBy).toBe('due')
  })

  it('add_returnsNumericId', async () => {
    const id = await savedViewRepository.add(makeView())
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)
  })

  it('getAll_multipleSavedViews_orderedBySortOrder', async () => {
    await savedViewRepository.add(makeView({ name: 'Second', sortOrder: 2 }))
    await savedViewRepository.add(makeView({ name: 'First', sortOrder: 1 }))
    await savedViewRepository.add(makeView({ name: 'Third', sortOrder: 3 }))

    const views = await savedViewRepository.getAll()
    expect(views.map(v => v.name)).toEqual(['First', 'Second', 'Third'])
  })

  it('update_modifiesNameAndSortBy', async () => {
    const id = await savedViewRepository.add(makeView({ name: 'Old Name', sortBy: 'priority' }))
    await savedViewRepository.update(id, { name: 'New Name', sortBy: 'tag' })

    const views = await savedViewRepository.getAll()
    expect(views[0].name).toBe('New Name')
    expect(views[0].sortBy).toBe('tag')
  })

  it('update_partialChanges_doesNotAffectOtherFields', async () => {
    const id = await savedViewRepository.add(makeView({ name: 'Keep Me', sortBy: 'due', sortOrder: 5 }))
    await savedViewRepository.update(id, { name: 'Renamed' })

    const views = await savedViewRepository.getAll()
    expect(views[0].sortBy).toBe('due')
    expect(views[0].sortOrder).toBe(5)
  })

  it('remove_deletesView', async () => {
    const id = await savedViewRepository.add(makeView())
    await savedViewRepository.remove(id)

    const views = await savedViewRepository.getAll()
    expect(views).toHaveLength(0)
  })

  it('remove_onlyDeletesTargetView_leavesOthersIntact', async () => {
    const id1 = await savedViewRepository.add(makeView({ name: 'Keep' }))
    const id2 = await savedViewRepository.add(makeView({ name: 'Delete me' }))

    await savedViewRepository.remove(id2)

    const views = await savedViewRepository.getAll()
    expect(views).toHaveLength(1)
    expect(views[0].id).toBe(id1)
    expect(views[0].name).toBe('Keep')
  })

  it('update_withFiltersSnapshot_persistsFilters', async () => {
    const id = await savedViewRepository.add(makeView())
    const filters = {
      priorities: [2],
      showCompleted: true,
      showAssigned: true,
      starredOnly: true,
      hardDeadlineOnly: false,
      personIds: [1, 2],
      tagIds: null,
      orgIds: null,
      dateRangeIncludeNoDue: true,
    }
    await savedViewRepository.update(id, { filters })

    const views = await savedViewRepository.getAll()
    expect(views[0].filters.priorities).toEqual([2])
    expect(views[0].filters.personIds).toEqual([1, 2])
    expect(views[0].filters.showCompleted).toBe(true)
  })
})
