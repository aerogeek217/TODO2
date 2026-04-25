import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { liftRailsRuntimeFilterValues, runV41Migration } from '../../data/database'

/**
 * v41 lifts every persisted `runtimeFilterValue` from a scalar `number` to a
 * single-entry `number[]` so the multi-value runtime filter (lists-consistency
 * P5) reads existing data unchanged. Two carriers: `listInsets` rows (column
 * field) and `settings.canvasRails` JSON (per-tab field).
 */
describe('runV41Migration', () => {
  const DB_NAME = 'todo2-v41-test'

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  it('lifts scalar runtimeFilterValue on listInsets rows to a single-entry array', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      listInsets: '++id, canvasId',
      settings: 'key',
    })
    await db.open()
    const insets = db.table('listInsets')
    await insets.add({ listDefinitionId: 1, canvasId: 1, x: 0, y: 0, width: 200, height: 200, isCollapsed: false, runtimeFilterValue: 7 })
    await insets.add({ listDefinitionId: 2, canvasId: 1, x: 0, y: 0, width: 200, height: 200, isCollapsed: false, runtimeFilterValue: 12 })
    // Row without a pick — unaffected.
    await insets.add({ listDefinitionId: 3, canvasId: 1, x: 0, y: 0, width: 200, height: 200, isCollapsed: false })
    db.close()

    const db2 = new Dexie(DB_NAME)
    db2.version(1).stores({ listInsets: '++id, canvasId', settings: 'key' })
    db2.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await runV41Migration(tx)
      })
    await db2.open()

    const rows = await db2.table('listInsets').orderBy(':id').toArray()
    expect(rows[0].runtimeFilterValue).toEqual([7])
    expect(rows[1].runtimeFilterValue).toEqual([12])
    expect(rows[2].runtimeFilterValue).toBeUndefined()
    db2.close()
  })

  it('is idempotent — array-shaped runtimeFilterValue passes through', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listInsets: '++id, canvasId', settings: 'key' })
    await db.open()
    await db.table('listInsets').add({
      listDefinitionId: 1, canvasId: 1, x: 0, y: 0, width: 200, height: 200, isCollapsed: false,
      runtimeFilterValue: [3, 5, 8],
    })

    await db.transaction('rw', db.table('listInsets'), db.table('settings'), async (tx) => {
      await runV41Migration(tx as unknown as Parameters<typeof runV41Migration>[0])
    })

    const rows = await db.table('listInsets').toArray()
    expect(rows[0].runtimeFilterValue).toEqual([3, 5, 8])
    db.close()
  })

  it('lifts scalar runtimeFilterValue on canvasRails tabs in settings', async () => {
    const railsBefore = JSON.stringify({
      left: {
        orientation: 'vertical',
        slots: [{
          id: 'slot-1',
          tabs: [
            { id: 't1', type: 'lens', listDefinitionId: 1, runtimeFilterValue: 11 },
            { id: 't2', type: 'lens', listDefinitionId: 2 }, // no pick
          ],
          activeTabId: 't1',
        }],
      },
      right: null, top: null, bottom: null,
    })

    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listInsets: '++id, canvasId', settings: 'key' })
    await db.open()
    await db.table('settings').put({ key: 'canvasRails', value: railsBefore })
    db.close()

    const db2 = new Dexie(DB_NAME)
    db2.version(1).stores({ listInsets: '++id, canvasId', settings: 'key' })
    db2.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await runV41Migration(tx)
      })
    await db2.open()

    const setting = await db2.table('settings').get('canvasRails')
    const parsed = JSON.parse(setting.value)
    expect(parsed.left.slots[0].tabs[0].runtimeFilterValue).toEqual([11])
    expect(parsed.left.slots[0].tabs[1].runtimeFilterValue).toBeUndefined()
    db2.close()
  })

  it('skips canvasRails when the setting is absent', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listInsets: '++id, canvasId', settings: 'key' })
    await db.open()
    await db.transaction('rw', db.table('listInsets'), db.table('settings'), async (tx) => {
      await runV41Migration(tx as unknown as Parameters<typeof runV41Migration>[0])
    })
    // No-op — no settings row created.
    expect(await db.table('settings').count()).toBe(0)
    db.close()
  })
})

describe('liftRailsRuntimeFilterValues (pure helper)', () => {
  it('lifts every scalar tab.runtimeFilterValue across all four rail sides', () => {
    const before = JSON.stringify({
      left: { orientation: 'vertical', slots: [{ id: 'a', tabs: [{ id: 't1', type: 'lens', runtimeFilterValue: 1 }], activeTabId: 't1' }] },
      right: { orientation: 'vertical', slots: [{ id: 'b', tabs: [{ id: 't2', type: 'lens', runtimeFilterValue: 2 }], activeTabId: 't2' }] },
      top: null,
      bottom: { orientation: 'horizontal', slots: [{ id: 'c', tabs: [{ id: 't3', type: 'lens', runtimeFilterValue: 3 }], activeTabId: 't3' }] },
    })
    const after = liftRailsRuntimeFilterValues(before)
    const parsed = JSON.parse(after!)
    expect(parsed.left.slots[0].tabs[0].runtimeFilterValue).toEqual([1])
    expect(parsed.right.slots[0].tabs[0].runtimeFilterValue).toEqual([2])
    expect(parsed.bottom.slots[0].tabs[0].runtimeFilterValue).toEqual([3])
  })

  it('returns input unchanged when no scalars are present', () => {
    const arrayShape = JSON.stringify({
      left: { orientation: 'vertical', slots: [{ id: 'a', tabs: [{ id: 't1', type: 'lens', runtimeFilterValue: [4, 5] }], activeTabId: 't1' }] },
      right: null, top: null, bottom: null,
    })
    expect(liftRailsRuntimeFilterValues(arrayShape)).toBe(arrayShape)
  })

  it('returns invalid JSON unchanged', () => {
    expect(liftRailsRuntimeFilterValues('{not json')).toBe('{not json')
  })

  it('returns the input untouched when it is undefined', () => {
    expect(liftRailsRuntimeFilterValues(undefined)).toBeUndefined()
  })
})
