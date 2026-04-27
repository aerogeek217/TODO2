import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import {
  flattenListSortValue,
  flattenListGroupingValue,
  flattenListDefinitionInPlace,
  runV46Migration,
} from '../../data/database'

/**
 * v46 flattens `ListDefinition.sort` / `.grouping` from the legacy
 * discriminated-union shape to flat `TodoSortBy` / `TodoGroupBy` literals
 * (ui-consistency-2026-04-25 P4).
 */
describe('flattenListSortValue', () => {
  it('passes through a flat valid TodoSortBy literal unchanged', () => {
    expect(flattenListSortValue('manual')).toBe('manual')
    expect(flattenListSortValue('date')).toBe('date')
    expect(flattenListSortValue('scheduled')).toBe('scheduled')
    expect(flattenListSortValue('deadline')).toBe('deadline')
    expect(flattenListSortValue('name')).toBe('name')
    expect(flattenListSortValue('created')).toBe('created')
    expect(flattenListSortValue('people')).toBe('people')
    expect(flattenListSortValue('project')).toBe('project')
    expect(flattenListSortValue('org')).toBe('org')
    expect(flattenListSortValue('status')).toBe('status')
  })

  it('falls back to manual on an unknown flat string', () => {
    expect(flattenListSortValue('unknown')).toBe('manual')
    expect(flattenListSortValue('priority')).toBe('manual')
    expect(flattenListSortValue('tag')).toBe('manual') // 'tag' is a TodoGroupBy, not TodoSortBy
  })

  it("maps {kind:'sort-order'} → 'manual'", () => {
    expect(flattenListSortValue({ kind: 'sort-order' })).toBe('manual')
  })

  it("maps {kind:'effective-date-asc'} → 'date'", () => {
    expect(flattenListSortValue({ kind: 'effective-date-asc' })).toBe('date')
  })

  it("maps {kind:'scheduled-asc'} → 'scheduled'", () => {
    expect(flattenListSortValue({ kind: 'scheduled-asc' })).toBe('scheduled')
  })

  it("maps {kind:'deadline-asc'} → 'deadline'", () => {
    expect(flattenListSortValue({ kind: 'deadline-asc' })).toBe('deadline')
  })

  it("maps {kind:'sortBy', by:'date'} → 'date'", () => {
    expect(flattenListSortValue({ kind: 'sortBy', by: 'date' })).toBe('date')
    expect(flattenListSortValue({ kind: 'sortBy', by: 'project' })).toBe('project')
    expect(flattenListSortValue({ kind: 'sortBy', by: 'people' })).toBe('people')
  })

  it("maps {kind:'sortBy', by: <unknown>} → 'manual'", () => {
    expect(flattenListSortValue({ kind: 'sortBy', by: 'priority' })).toBe('manual')
    expect(flattenListSortValue({ kind: 'sortBy' })).toBe('manual')
  })

  it('falls back to manual on null/undefined/non-object inputs', () => {
    expect(flattenListSortValue(null)).toBe('manual')
    expect(flattenListSortValue(undefined)).toBe('manual')
    expect(flattenListSortValue(42)).toBe('manual')
    expect(flattenListSortValue([])).toBe('manual')
  })
})

describe('flattenListGroupingValue', () => {
  it('passes through a flat valid TodoGroupBy literal unchanged', () => {
    expect(flattenListGroupingValue('none', 'manual')).toBe('none')
    expect(flattenListGroupingValue('date', 'manual')).toBe('date')
    expect(flattenListGroupingValue('scheduled', 'manual')).toBe('scheduled')
    expect(flattenListGroupingValue('deadline', 'manual')).toBe('deadline')
    expect(flattenListGroupingValue('people', 'manual')).toBe('people')
    expect(flattenListGroupingValue('project', 'manual')).toBe('project')
    expect(flattenListGroupingValue('org', 'manual')).toBe('org')
    expect(flattenListGroupingValue('status', 'manual')).toBe('status')
    expect(flattenListGroupingValue('tag', 'manual')).toBe('tag')
  })

  it('falls back to none on an unknown flat string', () => {
    expect(flattenListGroupingValue('unknown', 'manual')).toBe('none')
    expect(flattenListGroupingValue('manual', 'manual')).toBe('none') // 'manual' is sort-only
    expect(flattenListGroupingValue('name', 'manual')).toBe('none')
    expect(flattenListGroupingValue('created', 'manual')).toBe('none')
  })

  it("maps {kind:'none'} → 'none'", () => {
    expect(flattenListGroupingValue({ kind: 'none' }, 'manual')).toBe('none')
  })

  it("maps {kind:'relative-effective'} → 'date'", () => {
    expect(flattenListGroupingValue({ kind: 'relative-effective' }, 'manual')).toBe('date')
  })

  it("maps {kind:'relative-deadline'} → 'deadline'", () => {
    expect(flattenListGroupingValue({ kind: 'relative-deadline' }, 'manual')).toBe('deadline')
  })

  it("maps {kind:'by-tag'} → 'tag'", () => {
    expect(flattenListGroupingValue({ kind: 'by-tag' }, 'manual')).toBe('tag')
  })

  it("maps {kind:'by-field', by:'project'} → 'project'", () => {
    expect(flattenListGroupingValue({ kind: 'by-field', by: 'project' }, 'manual')).toBe('project')
    expect(flattenListGroupingValue({ kind: 'by-field', by: 'date' }, 'manual')).toBe('date')
    expect(flattenListGroupingValue({ kind: 'by-field', by: 'people' }, 'manual')).toBe('people')
  })

  it("maps {kind:'by-field', by:<unknown>} → 'none'", () => {
    expect(flattenListGroupingValue({ kind: 'by-field', by: 'priority' }, 'manual')).toBe('none')
    expect(flattenListGroupingValue({ kind: 'by-field' }, 'manual')).toBe('none')
  })

  it("maps {kind:'by-sortBy'} to flatSort when flatSort is a valid TodoGroupBy", () => {
    expect(flattenListGroupingValue({ kind: 'by-sortBy' }, 'date')).toBe('date')
    expect(flattenListGroupingValue({ kind: 'by-sortBy' }, 'project')).toBe('project')
    expect(flattenListGroupingValue({ kind: 'by-sortBy' }, 'people')).toBe('people')
  })

  it("maps {kind:'by-sortBy'} → 'none' when flatSort is sort-only ('manual'/'name'/'created')", () => {
    expect(flattenListGroupingValue({ kind: 'by-sortBy' }, 'manual')).toBe('none')
    expect(flattenListGroupingValue({ kind: 'by-sortBy' }, 'name')).toBe('none')
    expect(flattenListGroupingValue({ kind: 'by-sortBy' }, 'created')).toBe('none')
  })
})

describe('flattenListDefinitionInPlace', () => {
  it('rewrites a legacy-shape def in place and returns true', () => {
    const def: Record<string, unknown> = {
      name: 'Old',
      sort: { kind: 'sortBy', by: 'date' },
      grouping: { kind: 'by-sortBy' },
    }
    const touched = flattenListDefinitionInPlace(def)
    expect(touched).toBe(true)
    expect(def.sort).toBe('date')
    expect(def.grouping).toBe('date')
  })

  it('is a no-op on already-flat shape and returns false', () => {
    const def: Record<string, unknown> = {
      name: 'Already flat',
      sort: 'date',
      grouping: 'project',
    }
    const touched = flattenListDefinitionInPlace(def)
    expect(touched).toBe(false)
    expect(def.sort).toBe('date')
    expect(def.grouping).toBe('project')
  })

  it('rewrites partially-flat shape (sort flat, grouping union)', () => {
    const def: Record<string, unknown> = {
      name: 'Partial',
      sort: 'manual',
      grouping: { kind: 'by-tag' },
    }
    const touched = flattenListDefinitionInPlace(def)
    expect(touched).toBe(true)
    expect(def.sort).toBe('manual')
    expect(def.grouping).toBe('tag')
  })
})

describe('runV46Migration', () => {
  const DB_NAME = 'todo2-v46-test'

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  it('flattens every legacy-shape listDefinition row in place', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listDefinitions: '++id, sortOrder' })
    await db.open()
    await db.table('listDefinitions').bulkAdd([
      { name: 'A', sortOrder: 0, sort: { kind: 'sort-order' }, grouping: { kind: 'none' } },
      { name: 'B', sortOrder: 1, sort: { kind: 'effective-date-asc' }, grouping: { kind: 'relative-effective' } },
      { name: 'C', sortOrder: 2, sort: { kind: 'sortBy', by: 'project' }, grouping: { kind: 'by-field', by: 'project' } },
      { name: 'D', sortOrder: 3, sort: { kind: 'sortBy', by: 'date' }, grouping: { kind: 'by-sortBy' } },
      { name: 'E', sortOrder: 4, sort: { kind: 'sortBy', by: 'deadline' }, grouping: { kind: 'by-tag' } },
    ])
    db.close()

    const db2 = new Dexie(DB_NAME)
    db2.version(1).stores({ listDefinitions: '++id, sortOrder' })
    db2.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await runV46Migration(tx)
      })
    await db2.open()

    const rows = await db2.table('listDefinitions').orderBy('sortOrder').toArray()
    expect(rows[0].sort).toBe('manual')
    expect(rows[0].grouping).toBe('none')
    expect(rows[1].sort).toBe('date')
    expect(rows[1].grouping).toBe('date')
    expect(rows[2].sort).toBe('project')
    expect(rows[2].grouping).toBe('project')
    expect(rows[3].sort).toBe('date')
    expect(rows[3].grouping).toBe('date') // by-sortBy resolved against flat sort
    expect(rows[4].sort).toBe('deadline')
    expect(rows[4].grouping).toBe('tag')
    db2.close()
  })

  it('is idempotent — already-flat rows pass through unchanged', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listDefinitions: '++id, sortOrder' })
    await db.open()
    await db.table('listDefinitions').bulkAdd([
      { name: 'A', sortOrder: 0, sort: 'manual', grouping: 'none' },
      { name: 'B', sortOrder: 1, sort: 'date', grouping: 'project' },
    ])

    await db.transaction('rw', db.table('listDefinitions'), async (tx) => {
      await runV46Migration(tx as unknown as Parameters<typeof runV46Migration>[0])
    })

    const rows = await db.table('listDefinitions').orderBy('sortOrder').toArray()
    expect(rows[0].sort).toBe('manual')
    expect(rows[0].grouping).toBe('none')
    expect(rows[1].sort).toBe('date')
    expect(rows[1].grouping).toBe('project')
    db.close()
  })

  it('falls back gracefully on unknown shapes', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listDefinitions: '++id, sortOrder' })
    await db.open()
    await db.table('listDefinitions').bulkAdd([
      { name: 'A', sortOrder: 0, sort: { kind: 'mystery' }, grouping: { kind: 'mystery' } },
      { name: 'B', sortOrder: 1, sort: 'priority', grouping: 'priority' },
    ])

    await db.transaction('rw', db.table('listDefinitions'), async (tx) => {
      await runV46Migration(tx as unknown as Parameters<typeof runV46Migration>[0])
    })

    const rows = await db.table('listDefinitions').orderBy('sortOrder').toArray()
    expect(rows[0].sort).toBe('manual')
    expect(rows[0].grouping).toBe('none')
    expect(rows[1].sort).toBe('manual')
    expect(rows[1].grouping).toBe('none')
    db.close()
  })

  it('no-ops on an empty table', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listDefinitions: '++id, sortOrder' })
    await db.open()
    await db.transaction('rw', db.table('listDefinitions'), async (tx) => {
      await runV46Migration(tx as unknown as Parameters<typeof runV46Migration>[0])
    })
    expect(await db.table('listDefinitions').count()).toBe(0)
    db.close()
  })
})
