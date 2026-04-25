import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import {
  appendTagNamesToTitle,
  buildTagNamesByTodo,
  runV29Migration,
} from '../../data/database'

describe('appendTagNamesToTitle', () => {
  it('appends each tag as " #tagname" to a non-empty title', () => {
    expect(appendTagNamesToTitle('Buy milk', ['urgent', 'errand']))
      .toBe('Buy milk #urgent #errand')
  })

  it('omits the leading space when the title is empty', () => {
    expect(appendTagNamesToTitle('', ['urgent'])).toBe('#urgent')
  })

  it('returns the title unchanged when no tag names survive trimming', () => {
    expect(appendTagNamesToTitle('Buy milk', ['', '   '])).toBe('Buy milk')
  })

  it('trims whitespace around each tag name', () => {
    expect(appendTagNamesToTitle('t', ['  urgent  ', 'errand']))
      .toBe('t #urgent #errand')
  })

  it('is a no-op when the tag list is empty', () => {
    expect(appendTagNamesToTitle('Buy milk', [])).toBe('Buy milk')
  })
})

describe('buildTagNamesByTodo', () => {
  it('groups tag names per todoId via the join + tag arrays', () => {
    const map = buildTagNamesByTodo(
      [
        { todoId: 1, tagId: 10 },
        { todoId: 1, tagId: 20 },
        { todoId: 2, tagId: 20 },
      ],
      [
        { id: 10, name: 'urgent' },
        { id: 20, name: 'today' },
      ],
    )
    expect(map.get(1)).toEqual(['urgent', 'today'])
    expect(map.get(2)).toEqual(['today'])
  })

  it('drops join rows whose tagId resolves to no registry entry', () => {
    const map = buildTagNamesByTodo(
      [
        { todoId: 1, tagId: 10 },
        { todoId: 1, tagId: 999 },
      ],
      [{ id: 10, name: 'urgent' }],
    )
    expect(map.get(1)).toEqual(['urgent'])
  })

  it('returns an empty map when there are no joins', () => {
    expect(buildTagNamesByTodo([], [{ id: 1, name: 'x' }]).size).toBe(0)
  })

  it('ignores tags rows missing a numeric id', () => {
    const map = buildTagNamesByTodo(
      [{ todoId: 1, tagId: 10 }],
      [{ name: 'no-id' }, { id: 10, name: 'urgent' }],
    )
    expect(map.get(1)).toEqual(['urgent'])
  })
})

describe('runV29Migration (end-to-end)', () => {
  const DB_NAME = 'todo2-v29-test'
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
  })

  async function openV28(): Promise<Dexie> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      todos: '++id, sortOrder',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      listDefinitions: '++id, sortOrder',
      savedViews: '++id, sortOrder',
    })
    await db.open()
    return db
  }

  async function openAtV29(): Promise<Dexie> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      todos: '++id, sortOrder',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      listDefinitions: '++id, sortOrder',
      savedViews: '++id, sortOrder',
    })
    db.version(2)
      .stores({
        tags: null,
        todoTags: null,
      })
      .upgrade(async (tx) => {
        await runV29Migration(tx)
      })
    await db.open()
    return db
  }

  it('bakes assigned tag names into each todo title and drops the tag tables', async () => {
    const pre = await openV28()
    await pre.table('todos').bulkAdd([
      { id: 1, title: 'Buy milk', isCompleted: false, sortOrder: 0 },
      { id: 2, title: 'Untagged', isCompleted: false, sortOrder: 1 },
    ])
    await pre.table('tags').bulkAdd([
      { id: 10, name: 'urgent', color: '#000' },
      { id: 20, name: 'errand', color: '#000' },
    ])
    await pre.table('todoTags').bulkAdd([
      { todoId: 1, tagId: 10 },
      { todoId: 1, tagId: 20 },
    ])
    pre.close()

    const post = await openAtV29()
    const t1 = await post.table('todos').get(1)
    const t2 = await post.table('todos').get(2)
    expect(t1.title).toBe('Buy milk #urgent #errand')
    expect(t2.title).toBe('Untagged')

    // Stores were dropped — accessing throws.
    expect(() => post.table('tags')).toThrow()
    expect(() => post.table('todoTags')).toThrow()
    post.close()
  })

  it('strips tagIds from custom predicate inside listDefinitions', async () => {
    const pre = await openV28()
    await pre.table('listDefinitions').bulkAdd([
      {
        name: 'Tagged',
        sortOrder: 0,
        pinnedToDashboard: true,
        membership: { kind: 'custom', predicate: { tagIds: [1, 2], showCompleted: false } },
        sort: { kind: 'sort-order' },
        grouping: { kind: 'none' },
      },
      {
        name: 'Today',
        sortOrder: 1,
        pinnedToDashboard: true,
        membership: { kind: 'today' },
        sort: { kind: 'sort-order' },
        grouping: { kind: 'none' },
      },
    ])
    pre.close()

    const post = await openAtV29()
    const defs = await post.table('listDefinitions').orderBy('sortOrder').toArray()
    expect((defs[0].membership as { predicate: Record<string, unknown> }).predicate)
      .not.toHaveProperty('tagIds')
    expect(defs[1].membership.kind).toBe('today')
    post.close()
  })

  it('strips tagIds + neutralises tag-based sort/group on savedViews', async () => {
    const pre = await openV28()
    await pre.table('savedViews').add({
      name: 'sv',
      sortBy: 'tag',
      groupBy: 'tag',
      sortOrder: 0,
      filters: { tagIds: [1, 2], showCompleted: false },
    })
    pre.close()

    const post = await openAtV29()
    const sv = (await post.table('savedViews').toArray())[0]
    expect((sv.filters as Record<string, unknown>)).not.toHaveProperty('tagIds')
    expect(sv.sortBy).toBe('date')
    expect(sv.groupBy).toBe('none')
    post.close()
  })

  it('is a no-op when the database has no tag data', async () => {
    const pre = await openV28()
    await pre.table('todos').add({ title: 'plain', isCompleted: false, sortOrder: 0 })
    pre.close()

    const post = await openAtV29()
    const todo = (await post.table('todos').toArray())[0]
    expect(todo.title).toBe('plain')
    post.close()
  })
})
