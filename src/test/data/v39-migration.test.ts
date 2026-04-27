import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import { runV39Migration } from '../../data/database'

/**
 * v39: fold `savedViews` into `listDefinitions` (favorited: true). Covered:
 *   - A savedView row with filters + groupBy + itemSortBy + maxTasks becomes
 *     a favorited ListDefinition with an equivalent custom predicate + sort +
 *     grouping + maxTasks / limitMode carry-through.
 *   - Pre-existing listDefinitions gain `favorited: false` when the field was
 *     absent; existing `favorited: true` is preserved.
 *   - Legacy starredOnly=true resolves to the seeded Follow-up statusId.
 *   - Empty savedViews is a no-op on counts but still backfills favorited.
 */
describe('runV39Migration', () => {
  const DB_NAME = 'todo2-v39-test'
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
  })

  async function openV38(): Promise<Dexie> {
    // Minimal pre-v39 shape: listDefinitions + savedViews + settings + statuses.
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      listDefinitions: '++id, sortOrder',
      savedViews: '++id, sortOrder',
      settings: 'key',
      statuses: '++id, sortOrder',
    })
    await db.open()
    return db
  }

  async function openAtV39(): Promise<Dexie> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      listDefinitions: '++id, sortOrder',
      savedViews: '++id, sortOrder',
      settings: 'key',
      statuses: '++id, sortOrder',
    })
    db.version(2)
      .stores({
        savedViews: null,
      })
      .upgrade(async (tx) => {
        await runV39Migration(tx)
      })
    await db.open()
    return db
  }

  it('translates a savedView row into a favorited listDefinition', async () => {
    const pre = await openV38()
    await pre.table('savedViews').add({
      name: 'My view',
      sortBy: 'date',
      groupBy: 'project',
      itemSortBy: 'deadline',
      sortOrder: 0,
      maxTasks: 20,
      limitMode: 'hard',
      filters: {
        showCompleted: true,
        showHiddenStatuses: false,
        personIds: [1, 2],
        orgIds: null,
        dateRangeIncludeNoDate: false,
      },
    })
    pre.close()

    const post = await openAtV39()
    const defs = await post.table('listDefinitions').toArray()
    expect(defs).toHaveLength(1)
    const d = defs[0]
    expect(d.name).toBe('My view')
    expect(d.favorited).toBe(true)
    expect(d.pinnedToDashboard).toBe(false)
    expect(d.maxTasks).toBe(20)
    expect(d.limitMode).toBe('hard')
    expect(d.membership.kind).toBe('custom')
    expect(d.membership.predicate.personIds).toEqual([1, 2])
    expect(d.membership.predicate.showCompleted).toBe(true)
    // Post ui-consistency-2026-04-25 P4 the encoder writes flat literals.
    // groupBy='project' + itemSortBy='deadline' → sort='deadline', grouping='project'
    expect(d.sort).toBe('deadline')
    expect(d.grouping).toBe('project')
    post.close()
  })

  it('backfills favorited: false on pre-existing listDefinitions without touching pre-set values', async () => {
    const pre = await openV38()
    await pre.table('listDefinitions').bulkAdd([
      {
        name: 'Legacy',
        sortOrder: 0,
        pinnedToDashboard: true,
        membership: { kind: 'custom', predicate: {} },
        sort: { kind: 'sort-order' },
        grouping: { kind: 'none' },
      },
      {
        name: 'Already fav',
        sortOrder: 1,
        pinnedToDashboard: false,
        favorited: true,
        membership: { kind: 'custom', predicate: {} },
        sort: { kind: 'sort-order' },
        grouping: { kind: 'none' },
      },
    ])
    pre.close()

    const post = await openAtV39()
    const defs = await post.table('listDefinitions').orderBy('sortOrder').toArray()
    expect(defs[0].favorited).toBe(false)
    expect(defs[1].favorited).toBe(true)
    post.close()
  })

  it('resolves legacy starredOnly filter against the seeded Follow-up status', async () => {
    const pre = await openV38()
    await pre.table('statuses').bulkAdd([
      { id: 10, name: 'Follow-up', color: '#F5A623', sortOrder: 0 },
      { id: 11, name: 'Assigned', color: '#537FE7', sortOrder: 1 },
    ])
    await pre.table('settings').bulkAdd([
      { key: 'seededAssignedStatusId', value: '11' },
      { key: 'seededFollowupStatusId', value: '10' },
    ])
    await pre.table('savedViews').add({
      name: 'Starred',
      sortBy: 'date',
      sortOrder: 0,
      filters: {
        personIds: null,
        orgIds: null,
        showCompleted: false,
        showHiddenStatuses: false,
        dateRangeIncludeNoDate: false,
        starredOnly: true,
      },
    })
    pre.close()

    const post = await openAtV39()
    const defs = await post.table('listDefinitions').toArray()
    expect(defs).toHaveLength(1)
    expect(defs[0].favorited).toBe(true)
    expect(defs[0].membership.predicate.statusIds).toEqual([10])
    post.close()
  })

  it('no-op on an empty savedViews table', async () => {
    const pre = await openV38()
    pre.close()
    const post = await openAtV39()
    expect(await post.table('listDefinitions').count()).toBe(0)
    post.close()
  })
})
