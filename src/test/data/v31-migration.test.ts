import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { runV31Migration } from '../../data/database'

/**
 * v31 strips the legacy `color` field from every `people` row. Verified by
 * booting a v30-shaped database, writing person rows with color, running the
 * migration, and asserting the field is gone while name/initials survive.
 */
describe('runV31Migration', () => {
  const DB_NAME = 'todo2-v31-test'

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  it('strips color from every person row while preserving name + initials', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ people: '++id, name' })
    await db.open()
    const people = db.table('people')
    await people.add({ name: 'Alice', initials: 'AL', color: '#ff0000' })
    await people.add({ name: 'Bob', initials: 'BO', color: '#00ff00' })
    await people.add({ name: 'No-Color', initials: 'NC' })
    db.close()

    const db2 = new Dexie(DB_NAME)
    db2.version(1).stores({ people: '++id, name' })
    db2.version(2).stores({}).upgrade(async (tx) => {
      await runV31Migration(tx)
    })
    await db2.open()

    const rows = await db2.table('people').toArray()
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row).not.toHaveProperty('color')
      expect(typeof row.name).toBe('string')
      expect(typeof row.initials).toBe('string')
    }
    db2.close()
  })

  it('is idempotent — running on a row without color leaves it untouched', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ people: '++id, name' })
    db.version(2).stores({}).upgrade(async (tx) => {
      await runV31Migration(tx)
    })
    await db.open()
    await db.table('people').add({ name: 'Alice', initials: 'AL' })

    // Re-run migration directly against the open DB.
    await db.transaction('rw', db.table('people'), async (tx) => {
      await runV31Migration(tx as unknown as Parameters<typeof runV31Migration>[0])
    })

    const rows = await db.table('people').toArray()
    expect(rows[0]).not.toHaveProperty('color')
    expect(rows[0].name).toBe('Alice')
    db.close()
  })
})
