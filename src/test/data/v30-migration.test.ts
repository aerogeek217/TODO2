import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import {
  ensureSeededDefaultTaskboard,
  tagRailsTaskboardSlots,
  runV30Migration,
} from '../../data/database'
import type { Taskboard, TaskboardEntry } from '../../models'

describe('ensureSeededDefaultTaskboard', () => {
  const DB_NAME = 'todo2-v30-seed-test'
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
  })

  async function openWithStores(): Promise<Dexie> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      taskboards: '++id',
      settings: '&key',
    })
    await db.open()
    return db
  }

  it('seeds the singleton row with the supplied legacy entries (sorted)', async () => {
    const db = await openWithStores()
    const id = await db.transaction('rw', [db.table('taskboards'), db.table('settings')], async () => {
      return ensureSeededDefaultTaskboard(
        db.table('taskboards') as unknown as Parameters<typeof ensureSeededDefaultTaskboard>[0],
        db.table('settings') as unknown as Parameters<typeof ensureSeededDefaultTaskboard>[1],
        [
          { todoId: 3, sortOrder: 3000 },
          { todoId: 1, sortOrder: 1000 },
          { todoId: 2, sortOrder: 2000 },
        ] as TaskboardEntry[],
      )
    })

    const board = await db.table('taskboards').get(id)
    expect(board.entries.map((e: TaskboardEntry) => e.todoId)).toEqual([1, 2, 3])
    const setting = await db.table('settings').get('defaultTaskboardId')
    expect(Number(setting.value)).toBe(id)
    db.close()
  })

  it('returns the existing taskboard id when settings.defaultTaskboardId already points at one', async () => {
    const db = await openWithStores()
    const seededId = await db.table('taskboards').add({
      name: 'Default',
      entries: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Taskboard) as number
    await db.table('settings').put({ key: 'defaultTaskboardId', value: String(seededId) })

    const returnedId = await db.transaction('rw', [db.table('taskboards'), db.table('settings')], async () => {
      return ensureSeededDefaultTaskboard(
        db.table('taskboards') as unknown as Parameters<typeof ensureSeededDefaultTaskboard>[0],
        db.table('settings') as unknown as Parameters<typeof ensureSeededDefaultTaskboard>[1],
        [{ todoId: 99, sortOrder: 0 }] as TaskboardEntry[],
      )
    })
    expect(returnedId).toBe(seededId)

    // A previously-seeded board must not absorb the supplied entries.
    const board = await db.table('taskboards').get(seededId)
    expect(board.entries).toEqual([])
    db.close()
  })

  it('adopts the first existing taskboard row when settings is missing the pointer', async () => {
    const db = await openWithStores()
    const existingId = await db.table('taskboards').add({
      name: 'Already-here',
      entries: [{ todoId: 7, sortOrder: 0 }],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Taskboard) as number

    const id = await db.transaction('rw', [db.table('taskboards'), db.table('settings')], async () => {
      return ensureSeededDefaultTaskboard(
        db.table('taskboards') as unknown as Parameters<typeof ensureSeededDefaultTaskboard>[0],
        db.table('settings') as unknown as Parameters<typeof ensureSeededDefaultTaskboard>[1],
        [],
      )
    })
    expect(id).toBe(existingId)
    const setting = await db.table('settings').get('defaultTaskboardId')
    expect(Number(setting.value)).toBe(existingId)
    db.close()
  })
})

describe('tagRailsTaskboardSlots', () => {
  it('tags every taskboard tab missing a taskboardId with the supplied default id', () => {
    const railsJson = JSON.stringify({
      left: {
        orientation: 'vertical',
        slots: [
          { id: 's1', tabs: [{ id: 's1-t0', type: 'taskboard' }], activeTabId: 's1-t0' },
          { id: 's2', tabs: [{ id: 's2-t0', type: 'lens', listDefinitionId: 1 }], activeTabId: 's2-t0' },
        ],
      },
      right: null, top: null, bottom: null,
    })
    const next = tagRailsTaskboardSlots(railsJson, 42)
    expect(next).not.toBe(railsJson)
    const parsed = JSON.parse(next!)
    expect(parsed.left.slots[0].tabs[0].taskboardId).toBe(42)
    expect(parsed.left.slots[1].tabs[0].taskboardId).toBeUndefined()
  })

  it('tags legacy flat-shape taskboard slots with the supplied id', () => {
    const railsJson = JSON.stringify({
      left: { orientation: 'vertical', slots: [{ id: 's1', kind: 'taskboard' }] },
      right: null, top: null, bottom: null,
    })
    const next = tagRailsTaskboardSlots(railsJson, 7)
    const parsed = JSON.parse(next!)
    expect(parsed.left.slots[0].taskboardId).toBe(7)
  })

  it('preserves an explicit taskboardId on a tab that already has one', () => {
    const railsJson = JSON.stringify({
      left: {
        orientation: 'vertical',
        slots: [
          { id: 's1', tabs: [{ id: 's1-t0', type: 'taskboard', taskboardId: 99 }], activeTabId: 's1-t0' },
        ],
      },
      right: null, top: null, bottom: null,
    })
    expect(tagRailsTaskboardSlots(railsJson, 42)).toBe(railsJson)
  })

  it('returns the original value when no taskboard slot/tab is present', () => {
    const railsJson = JSON.stringify({
      left: {
        orientation: 'vertical',
        slots: [{ id: 's1', tabs: [{ id: 's1-t0', type: 'lens', listDefinitionId: 1 }], activeTabId: 's1-t0' }],
      },
      right: null, top: null, bottom: null,
    })
    expect(tagRailsTaskboardSlots(railsJson, 42)).toBe(railsJson)
  })

  it('returns the original value (no throw) on invalid JSON', () => {
    expect(tagRailsTaskboardSlots('not-json', 1)).toBe('not-json')
    expect(tagRailsTaskboardSlots(undefined, 1)).toBeUndefined()
  })
})

describe('runV30Migration (end-to-end)', () => {
  const DB_NAME = 'todo2-v30-test'
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
  })

  async function openV29(): Promise<Dexie> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      taskboardEntries: '++id, todoId',
      taskboards: '++id',
      settings: '&key',
    })
    await db.open()
    return db
  }

  async function openAtV30(): Promise<Dexie> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      taskboardEntries: '++id, todoId',
      taskboards: '++id',
      settings: '&key',
    })
    db.version(2)
      .stores({
        taskboardEntries: null,
        taskboards: '++id',
        floatingTaskboards: '++id, canvasId, taskboardId',
      })
      .upgrade(async (tx) => {
        await runV30Migration(tx)
      })
    await db.open()
    return db
  }

  it('collapses taskboardEntries into a single seeded Default taskboard', async () => {
    const pre = await openV29()
    await pre.table('taskboardEntries').bulkAdd([
      { todoId: 2, sortOrder: 2000 },
      { todoId: 1, sortOrder: 1000 },
      { todoId: 3, sortOrder: 3000 },
    ])
    pre.close()

    const post = await openAtV30()
    const boards = await post.table('taskboards').toArray()
    expect(boards).toHaveLength(1)
    expect(boards[0].entries.map((e: TaskboardEntry) => e.todoId)).toEqual([1, 2, 3])
    const setting = await post.table('settings').get('defaultTaskboardId')
    expect(Number(setting.value)).toBe(boards[0].id)
    post.close()
  })

  it('tags every rail taskboard slot with the seeded id', async () => {
    const pre = await openV29()
    await pre.table('taskboardEntries').add({ todoId: 1, sortOrder: 0 })
    await pre.table('settings').put({
      key: 'canvasRails',
      value: JSON.stringify({
        left: {
          orientation: 'vertical',
          slots: [
            { id: 's1', tabs: [{ id: 's1-t0', type: 'taskboard' }], activeTabId: 's1-t0' },
          ],
        },
        right: null, top: null, bottom: null,
      }),
    })
    pre.close()

    const post = await openAtV30()
    const boardId = (await post.table('taskboards').toArray())[0].id
    const railsRow = await post.table('settings').get('canvasRails')
    const parsed = JSON.parse(railsRow.value)
    expect(parsed.left.slots[0].tabs[0].taskboardId).toBe(boardId)
    post.close()
  })

  it('seeds an empty Default taskboard when taskboardEntries is empty', async () => {
    const pre = await openV29()
    pre.close()

    const post = await openAtV30()
    const boards = await post.table('taskboards').toArray()
    expect(boards).toHaveLength(1)
    expect(boards[0].entries).toEqual([])
    post.close()
  })

  it('runs cleanly when settings.canvasRails is absent', async () => {
    const pre = await openV29()
    await pre.table('taskboardEntries').add({ todoId: 1, sortOrder: 0 })
    pre.close()

    const post = await openAtV30()
    const boards = await post.table('taskboards').toArray()
    expect(boards).toHaveLength(1)
    expect(boards[0].entries.map((e: TaskboardEntry) => e.todoId)).toEqual([1])
    expect(await post.table('settings').get('canvasRails')).toBeUndefined()
    post.close()
  })
})
