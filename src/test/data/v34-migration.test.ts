import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { runV34Migration } from '../../data/database'

/**
 * v34 strips the `parentId` field from every `todos` row and drops the
 * matching index from the schema string. Verified by booting a v33-shaped
 * database with the `parentId` index, writing rows with `parentId`, then
 * opening at v34 with the updated schema + migration.
 */
describe('runV34Migration', () => {
  const DB_NAME = 'todo2-v34-test'

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  it('strips parentId from every todo row while preserving other fields', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      todos: '++id, projectId, canvasId, parentId, isCompleted, dueDate, sortOrder, statusId',
    })
    await db.open()
    const todos = db.table('todos')
    await todos.add({ title: 'child-1', parentId: 42, sortOrder: 0, isCompleted: false })
    await todos.add({ title: 'child-2', parentId: 42, sortOrder: 1, isCompleted: false })
    await todos.add({ title: 'orphan', sortOrder: 2, isCompleted: false })
    db.close()

    const db2 = new Dexie(DB_NAME)
    db2.version(1).stores({
      todos: '++id, projectId, canvasId, parentId, isCompleted, dueDate, sortOrder, statusId',
    })
    db2.version(2)
      .stores({
        todos: '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId',
      })
      .upgrade(async (tx) => {
        await runV34Migration(tx)
      })
    await db2.open()

    const rows = await db2.table('todos').toArray()
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row).not.toHaveProperty('parentId')
      expect(typeof row.title).toBe('string')
    }

    // Proxy for "index was dropped": regular queries continue to work post-migration.
    const byProject = await db2.table('todos').where('sortOrder').equals(0).toArray()
    expect(byProject).toHaveLength(1)
    expect(byProject[0].title).toBe('child-1')

    db2.close()
  })

  it('is idempotent — running on a row without parentId leaves it untouched', async () => {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      todos: '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId',
    })
    await db.open()
    await db.table('todos').add({ title: 'clean', sortOrder: 0, isCompleted: false })

    await db.transaction('rw', db.table('todos'), async (tx) => {
      await runV34Migration(tx as unknown as Parameters<typeof runV34Migration>[0])
    })

    const rows = await db.table('todos').toArray()
    expect(rows[0]).not.toHaveProperty('parentId')
    expect(rows[0].title).toBe('clean')
    db.close()
  })
})
