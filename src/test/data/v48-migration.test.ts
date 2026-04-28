import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { unwrapRuntimeFilterSpecInPlace, runV48Migration } from '../../data/database'

/**
 * v48 unwinds the short-lived v47 wrap of `runtimeFilter`. Rows shaped
 * `{ kind: 'value', field, label? }` flatten back to `{ field, label? }`;
 * experimental `{ kind: 'date-offset', ... }` rows are dropped (the offset
 * capability now rides `DateAnchor`).
 */
describe('runV48Migration', () => {
  const DB_NAME = 'todo2-v48-test'

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  it('flattens { kind: "value", field, label? } back to { field, label? }', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listDefinitions: '++id, sortOrder' })
    await db.open()
    await db.table('listDefinitions').add({
      name: 'Tasks for…',
      sortOrder: 0,
      runtimeFilter: { kind: 'value', field: 'person', label: 'Assignee' },
    })
    await db.table('listDefinitions').add({
      name: 'Org tasks',
      sortOrder: 1,
      runtimeFilter: { kind: 'value', field: 'org' },
    })
    db.close()

    const db2 = new Dexie(DB_NAME)
    db2.version(1).stores({ listDefinitions: '++id, sortOrder' })
    db2.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await runV48Migration(tx)
      })
    await db2.open()

    const rows = await db2.table('listDefinitions').orderBy('sortOrder').toArray()
    expect(rows[0].runtimeFilter).toEqual({ field: 'person', label: 'Assignee' })
    expect(rows[1].runtimeFilter).toEqual({ field: 'org' })
    db2.close()
  })

  it('drops { kind: "date-offset", ... } rows entirely', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listDefinitions: '++id, sortOrder' })
    await db.open()
    await db.table('listDefinitions').add({
      name: 'Stale tasks',
      sortOrder: 0,
      runtimeFilter: {
        kind: 'date-offset',
        source: 'scheduled',
        anchor: 'today',
        minDays: -7,
        maxDays: 0,
      },
    })
    db.close()

    const db2 = new Dexie(DB_NAME)
    db2.version(1).stores({ listDefinitions: '++id, sortOrder' })
    db2.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await runV48Migration(tx)
      })
    await db2.open()

    const row = await db2.table('listDefinitions').get(1)
    expect(row.runtimeFilter).toBeUndefined()
    db2.close()
  })

  it('leaves rows without a runtimeFilter alone', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ listDefinitions: '++id, sortOrder' })
    await db.open()
    await db.table('listDefinitions').add({ name: 'Plain', sortOrder: 0 })
    db.close()

    const db2 = new Dexie(DB_NAME)
    db2.version(1).stores({ listDefinitions: '++id, sortOrder' })
    db2.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await runV48Migration(tx)
      })
    await db2.open()

    const row = await db2.table('listDefinitions').get(1)
    expect(row.runtimeFilter).toBeUndefined()
    db2.close()
  })

  it('is idempotent — already-flat rows pass through', async () => {
    const def: Record<string, unknown> = {
      name: 'Already flat',
      runtimeFilter: { field: 'person', label: 'Owner' },
    }
    expect(unwrapRuntimeFilterSpecInPlace(def)).toBe('none')
    expect(def.runtimeFilter).toEqual({ field: 'person', label: 'Owner' })
  })

  it('drops a value-kind row missing the field discriminator', async () => {
    const def: Record<string, unknown> = {
      name: 'Broken',
      runtimeFilter: { kind: 'value' },
    }
    expect(unwrapRuntimeFilterSpecInPlace(def)).toBe('dropped')
    expect(def.runtimeFilter).toBeUndefined()
  })

  it('strips empty/whitespace label when unwrapping', async () => {
    const def: Record<string, unknown> = {
      name: 'Empty label',
      runtimeFilter: { kind: 'value', field: 'tag', label: '   ' },
    }
    expect(unwrapRuntimeFilterSpecInPlace(def)).toBe('unwrapped')
    expect(def.runtimeFilter).toEqual({ field: 'tag' })
  })
})
