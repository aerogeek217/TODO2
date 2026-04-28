import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { liftRuntimeFilterSpecInPlace, runV47Migration } from '../../data/database'

/**
 * v47 extends `ListDefinition.runtimeFilter` to a discriminated union — the
 * legacy `{ field, label? }` shape is rewritten in place to
 * `{ kind: 'value', field, label? }` so a new `{ kind: 'date-offset', ... }`
 * variant can land alongside (triage-2026-04-27-batch2 P8). Pre-migration
 * rows that already carry a `kind` discriminator pass through unchanged.
 */
describe('runV47Migration', () => {
  const DB_NAME = 'todo2-v47-test'

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  it('lifts legacy { field, label? } runtimeFilter to { kind: "value", ... }', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listDefinitions: '++id, sortOrder' })
    await db.open()
    await db.table('listDefinitions').add({
      name: 'Tasks for…',
      sortOrder: 0,
      pinnedToDashboard: false,
      favorited: true,
      membership: { kind: 'custom', predicate: {} },
      sort: 'manual',
      grouping: 'none',
      runtimeFilter: { field: 'person', label: 'Assignee' },
    })
    await db.table('listDefinitions').add({
      name: 'Org tasks',
      sortOrder: 1,
      pinnedToDashboard: false,
      favorited: false,
      membership: { kind: 'custom', predicate: {} },
      sort: 'manual',
      grouping: 'none',
      runtimeFilter: { field: 'org' },
    })
    // Row without a runtimeFilter — unaffected.
    await db.table('listDefinitions').add({
      name: 'Plain',
      sortOrder: 2,
      pinnedToDashboard: false,
      favorited: false,
      membership: { kind: 'custom', predicate: {} },
      sort: 'manual',
      grouping: 'none',
    })
    db.close()

    const db2 = new Dexie(DB_NAME)
    db2.version(1).stores({ listDefinitions: '++id, sortOrder' })
    db2.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await runV47Migration(tx)
      })
    await db2.open()

    const rows = await db2.table('listDefinitions').orderBy('sortOrder').toArray()
    expect(rows[0].runtimeFilter).toEqual({ kind: 'value', field: 'person', label: 'Assignee' })
    expect(rows[1].runtimeFilter).toEqual({ kind: 'value', field: 'org' })
    expect(rows[2].runtimeFilter).toBeUndefined()
    db2.close()
  })

  it('is idempotent — rows with kind=value pass through unchanged', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listDefinitions: '++id, sortOrder' })
    await db.open()
    const original = {
      name: 'Already migrated',
      sortOrder: 0,
      pinnedToDashboard: false,
      favorited: false,
      membership: { kind: 'custom', predicate: {} },
      sort: 'manual',
      grouping: 'none',
      runtimeFilter: { kind: 'value', field: 'project' },
    }
    await db.table('listDefinitions').add(original)

    await db.transaction('rw', db.table('listDefinitions'), async (tx) => {
      await runV47Migration(tx as unknown as Parameters<typeof runV47Migration>[0])
    })

    const rows = await db.table('listDefinitions').toArray()
    expect(rows[0].runtimeFilter).toEqual({ kind: 'value', field: 'project' })
    db.close()
  })

  it('leaves date-offset specs alone (forward compat)', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listDefinitions: '++id, sortOrder' })
    await db.open()
    await db.table('listDefinitions').add({
      name: 'Stale tasks',
      sortOrder: 0,
      pinnedToDashboard: false,
      favorited: false,
      membership: { kind: 'custom', predicate: {} },
      sort: 'manual',
      grouping: 'none',
      runtimeFilter: { kind: 'date-offset', source: 'scheduled', anchor: 'today', maxDays: -7 },
    })

    await db.transaction('rw', db.table('listDefinitions'), async (tx) => {
      await runV47Migration(tx as unknown as Parameters<typeof runV47Migration>[0])
    })

    const rows = await db.table('listDefinitions').toArray()
    expect(rows[0].runtimeFilter).toEqual({
      kind: 'date-offset', source: 'scheduled', anchor: 'today', maxDays: -7,
    })
    db.close()
  })
})

describe('liftRuntimeFilterSpecInPlace (pure helper)', () => {
  it('rewrites legacy shape and returns true', () => {
    const def = { runtimeFilter: { field: 'person', label: 'Assignee' } } as Record<string, unknown>
    expect(liftRuntimeFilterSpecInPlace(def)).toBe(true)
    expect(def.runtimeFilter).toEqual({ kind: 'value', field: 'person', label: 'Assignee' })
  })

  it('omits an empty / non-string label', () => {
    const def = { runtimeFilter: { field: 'project', label: '' } } as Record<string, unknown>
    expect(liftRuntimeFilterSpecInPlace(def)).toBe(true)
    expect(def.runtimeFilter).toEqual({ kind: 'value', field: 'project' })
  })

  it('returns false when no runtimeFilter is present', () => {
    const def = { name: 'no rt' } as Record<string, unknown>
    expect(liftRuntimeFilterSpecInPlace(def)).toBe(false)
  })

  it('returns false when runtimeFilter already carries a kind', () => {
    const def = { runtimeFilter: { kind: 'value', field: 'org' } } as Record<string, unknown>
    expect(liftRuntimeFilterSpecInPlace(def)).toBe(false)
    expect(def.runtimeFilter).toEqual({ kind: 'value', field: 'org' })
  })

  it('returns false when runtimeFilter has no recognisable field', () => {
    const def = { runtimeFilter: { label: 'Something' } } as Record<string, unknown>
    expect(liftRuntimeFilterSpecInPlace(def)).toBe(false)
  })
})
