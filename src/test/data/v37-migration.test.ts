import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import { runV37Migration } from '../../data/database'

describe('runV37Migration (end-to-end)', () => {
  const DB_NAME = 'todo2-v37-test'
  const TODOS_SCHEMA = '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId'
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
  })

  async function openV36(): Promise<Dexie> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      todos: TODOS_SCHEMA,
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
    })
    await db.open()
    return db
  }

  async function openAtV37(): Promise<Dexie> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      todos: TODOS_SCHEMA,
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
    })
    db.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await runV37Migration(tx)
      })
    await db.open()
    return db
  }

  it('strips the inline tags key from every todo row', async () => {
    const pre = await openV36()
    await pre.table('todos').bulkAdd([
      { title: 'a', isCompleted: false, sortOrder: 0, tags: ['urgent', 'today'] },
      { title: 'b', isCompleted: false, sortOrder: 1, tags: ['urgent'] },
      { title: 'c', isCompleted: false, sortOrder: 2 },
    ])
    pre.close()

    const post = await openAtV37()
    const rows = await post.table('todos').toArray()
    for (const r of rows) expect('tags' in r).toBe(false)
    post.close()
  })

  it('leaves the tags + todoTags tables untouched', async () => {
    const pre = await openV36()
    await pre.table('todos').add({
      title: 'a', isCompleted: false, sortOrder: 0, tags: ['urgent'],
    })
    await pre.table('tags').bulkAdd([
      { id: 1, name: 'urgent', color: '#537FE7' },
      { id: 2, name: 'today', color: '#abcdef' },
    ])
    await pre.table('todoTags').bulkAdd([
      { id: 1, todoId: 1, tagId: 1 },
    ])
    pre.close()

    const post = await openAtV37()
    const tags = await post.table('tags').toArray()
    expect(tags).toHaveLength(2)
    expect(tags.map((t) => t.name).sort()).toEqual(['today', 'urgent'])
    const joins = await post.table('todoTags').toArray()
    expect(joins).toHaveLength(1)
    expect(joins[0]).toMatchObject({ todoId: 1, tagId: 1 })
    post.close()
  })

  it('preserves other todo fields — only the tags key is removed', async () => {
    const pre = await openV36()
    await pre.table('todos').add({
      title: 'keep-me',
      isCompleted: false,
      sortOrder: 7,
      notes: 'some notes',
      statusId: 3,
      tags: ['alpha'],
    })
    pre.close()

    const post = await openAtV37()
    const row = await post.table('todos').toArray()
    expect(row).toHaveLength(1)
    const t = row[0]
    expect(t.title).toBe('keep-me')
    expect(t.sortOrder).toBe(7)
    expect(t.notes).toBe('some notes')
    expect(t.statusId).toBe(3)
    expect('tags' in t).toBe(false)
    post.close()
  })

  it('is a no-op on a DB with no inline tags anywhere', async () => {
    const pre = await openV36()
    await pre.table('todos').bulkAdd([
      { title: 'a', isCompleted: false, sortOrder: 0 },
      { title: 'b', isCompleted: false, sortOrder: 1 },
    ])
    pre.close()

    const post = await openAtV37()
    const rows = await post.table('todos').toArray()
    expect(rows).toHaveLength(2)
    for (const r of rows) expect('tags' in r).toBe(false)
    // No log emitted because no row was modified.
    expect(infoSpy).not.toHaveBeenCalledWith(expect.stringContaining('v37 migration'))
    post.close()
  })
})
