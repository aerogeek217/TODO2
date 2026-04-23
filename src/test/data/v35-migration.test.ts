import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'

/**
 * v35 re-introduces tags as an inline `tags?: string[]` field on todos. The
 * schema string is unchanged (no index), and the upgrade block is a no-op —
 * version 35 is purely audit/auditability. This test verifies:
 *
 *   1. A v34-shaped DB round-trips cleanly through the v35 open (rows preserved,
 *      no accidental `tags` key added).
 *   2. New v35 rows persist `tags` when written (Dexie stores the inline field
 *      even without an index).
 *   3. Existing rows without `tags` read back without the key (preserves the
 *      "omitted when empty" convention end-to-end).
 */
describe('v35 schema bump', () => {
  const DB_NAME = 'todo2-v35-test'
  const V34_TODOS_SCHEMA = '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId'

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  it('v34→v35 open is a no-op on existing rows', async () => {
    const dbV34 = new Dexie(DB_NAME)
    dbV34.version(1).stores({ todos: V34_TODOS_SCHEMA })
    await dbV34.open()
    await dbV34.table('todos').bulkAdd([
      { title: 'one', isCompleted: false, sortOrder: 0 },
      { title: 'two', isCompleted: true, sortOrder: 1 },
    ])
    dbV34.close()

    const dbV35 = new Dexie(DB_NAME)
    dbV35.version(1).stores({ todos: V34_TODOS_SCHEMA })
    dbV35.version(2).stores({}) // v35: no schema change, no upgrade
    await dbV35.open()

    const rows = await dbV35.table('todos').orderBy('sortOrder').toArray()
    expect(rows).toHaveLength(2)
    expect(rows[0].title).toBe('one')
    expect(rows[1].title).toBe('two')
    // No accidental default field added.
    for (const row of rows) {
      expect('tags' in row).toBe(false)
    }
    dbV35.close()
  })

  it('post-v35 rows persist inline tags', async () => {
    const dbV35 = new Dexie(DB_NAME)
    dbV35.version(1).stores({ todos: V34_TODOS_SCHEMA })
    dbV35.version(2).stores({})
    await dbV35.open()

    const id = await dbV35.table('todos').add({
      title: 'tagged',
      isCompleted: false,
      sortOrder: 0,
      tags: ['urgent', 'today'],
    }) as number

    const row = await dbV35.table('todos').get(id)
    expect(row.tags).toEqual(['urgent', 'today'])
    dbV35.close()
  })

  it('rows written without tags stay without the key', async () => {
    const dbV35 = new Dexie(DB_NAME)
    dbV35.version(1).stores({ todos: V34_TODOS_SCHEMA })
    dbV35.version(2).stores({})
    await dbV35.open()

    const id = await dbV35.table('todos').add({
      title: 'plain',
      isCompleted: false,
      sortOrder: 0,
    }) as number

    const row = await dbV35.table('todos').get(id)
    expect('tags' in row).toBe(false)
    dbV35.close()
  })
})
