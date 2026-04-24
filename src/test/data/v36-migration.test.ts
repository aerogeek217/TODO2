import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import {
  buildTagRegistryFromInline,
  translatePredicateTagsInPlace,
  translateListDefinitionTagsInPlace,
  translateSavedViewTagsInPlace,
  runV36Migration,
} from '../../data/database'

describe('buildTagRegistryFromInline', () => {
  it('collects unique lowercase slugs in first-seen order', () => {
    const { uniqueSlugs, joinsByTodoId } = buildTagRegistryFromInline([
      { id: 1, tags: ['urgent', 'today'] },
      { id: 2, tags: ['urgent', 'p1'] },
      { id: 3, tags: ['today'] },
    ])
    expect(uniqueSlugs).toEqual(['urgent', 'today', 'p1'])
    expect(joinsByTodoId.get(1)).toEqual(['urgent', 'today'])
    expect(joinsByTodoId.get(2)).toEqual(['urgent', 'p1'])
    expect(joinsByTodoId.get(3)).toEqual(['today'])
  })

  it('case-folds and trims incoming names', () => {
    const { uniqueSlugs } = buildTagRegistryFromInline([
      { id: 1, tags: ['Urgent', '  today  ', 'URGENT'] },
    ])
    expect(uniqueSlugs).toEqual(['urgent', 'today'])
  })

  it('drops empty / whitespace-only / non-string entries', () => {
    const { uniqueSlugs, joinsByTodoId } = buildTagRegistryFromInline([
      { id: 1, tags: ['', '  ', 'real', 42 as unknown as string, null as unknown as string] },
    ])
    expect(uniqueSlugs).toEqual(['real'])
    expect(joinsByTodoId.get(1)).toEqual(['real'])
  })

  it('ignores todos without an id or without a tags array', () => {
    const { uniqueSlugs, joinsByTodoId } = buildTagRegistryFromInline([
      { tags: ['orphan'] },
      { id: 2 },
      { id: 3, tags: 'not-an-array' as unknown as string[] },
    ])
    expect(uniqueSlugs).toEqual([])
    expect(joinsByTodoId.size).toBe(0)
  })

  it('skips todos whose tags array resolves to no usable entries', () => {
    const { joinsByTodoId } = buildTagRegistryFromInline([{ id: 1, tags: ['  ', ''] }])
    expect(joinsByTodoId.size).toBe(0)
  })
})

describe('translatePredicateTagsInPlace', () => {
  it('translates string slugs to ids, dropping unknowns into the collector', () => {
    const slugToId = new Map([['urgent', 1], ['p1', 2]])
    const unknown = new Set<string>()
    const obj: Record<string, unknown> = { tags: ['urgent', 'p1', 'mystery'] }
    const changed = translatePredicateTagsInPlace(obj, slugToId, unknown)
    expect(changed).toBe(true)
    expect(obj.tags).toEqual([1, 2])
    expect([...unknown]).toEqual(['mystery'])
  })

  it('no-ops when tags is not an array', () => {
    const unknown = new Set<string>()
    const objA: Record<string, unknown> = { tags: null }
    const objB: Record<string, unknown> = {}
    expect(translatePredicateTagsInPlace(objA, new Map(), unknown)).toBe(false)
    expect(translatePredicateTagsInPlace(objB, new Map(), unknown)).toBe(false)
  })

  it('is idempotent — numeric ids in the input pass through', () => {
    const slugToId = new Map([['urgent', 7]])
    const unknown = new Set<string>()
    const obj: Record<string, unknown> = { tags: [7, 'urgent'] }
    translatePredicateTagsInPlace(obj, slugToId, unknown)
    expect(obj.tags).toEqual([7, 7])
    expect(unknown.size).toBe(0)
  })

  it('case-folds slugs before lookup', () => {
    const slugToId = new Map([['urgent', 1]])
    const unknown = new Set<string>()
    const obj: Record<string, unknown> = { tags: ['Urgent', 'URGENT'] }
    translatePredicateTagsInPlace(obj, slugToId, unknown)
    expect(obj.tags).toEqual([1, 1])
    expect(unknown.size).toBe(0)
  })

  it('translateListDefinitionTagsInPlace only touches custom-membership defs', () => {
    const slugToId = new Map([['urgent', 1]])
    const unknown = new Set<string>()
    const customDef: Record<string, unknown> = {
      membership: { kind: 'custom', predicate: { tags: ['urgent'] } },
    }
    const otherDef: Record<string, unknown> = {
      membership: { kind: 'today' },
    }
    expect(translateListDefinitionTagsInPlace(customDef, slugToId, unknown)).toBe(true)
    expect(((customDef.membership as { predicate: { tags: unknown } }).predicate.tags)).toEqual([1])
    expect(translateListDefinitionTagsInPlace(otherDef, slugToId, unknown)).toBe(false)
  })

  it('translateSavedViewTagsInPlace rewrites filters.tags', () => {
    const slugToId = new Map([['urgent', 9]])
    const unknown = new Set<string>()
    const sv: Record<string, unknown> = { filters: { tags: ['urgent', 'missing'] } }
    translateSavedViewTagsInPlace(sv, slugToId, unknown)
    expect((sv.filters as { tags: unknown }).tags).toEqual([9])
    expect([...unknown]).toEqual(['missing'])
  })
})

describe('runV36Migration (end-to-end)', () => {
  const DB_NAME = 'todo2-v36-test'
  const V35_TODOS_SCHEMA = '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId'
  let warnSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    infoSpy.mockRestore()
  })

  async function openV35(): Promise<Dexie> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      todos: V35_TODOS_SCHEMA,
      listDefinitions: '++id, sortOrder',
      savedViews: '++id, sortOrder',
    })
    await db.open()
    return db
  }

  async function openAtV36(): Promise<Dexie> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({
      todos: V35_TODOS_SCHEMA,
      listDefinitions: '++id, sortOrder',
      savedViews: '++id, sortOrder',
    })
    db.version(2)
      .stores({
        tags: '++id, name',
        todoTags: '++id, todoId, tagId',
      })
      .upgrade(async (tx) => {
        await runV36Migration(tx)
      })
    await db.open()
    return db
  }

  it('seeds unique tags and emits todoTags joins from inline rows', async () => {
    const pre = await openV35()
    await pre.table('todos').bulkAdd([
      { title: 'a', isCompleted: false, sortOrder: 0, tags: ['urgent', 'today'] },
      { title: 'b', isCompleted: false, sortOrder: 1, tags: ['urgent', 'p1'] },
      { title: 'c', isCompleted: false, sortOrder: 2 },
    ])
    pre.close()

    const post = await openAtV36()
    const tags = await post.table('tags').orderBy('id').toArray()
    const names = tags.map((t) => t.name).sort()
    expect(names).toEqual(['p1', 'today', 'urgent'])
    for (const t of tags) expect(t.color).toBe('#537FE7')

    const joins = await post.table('todoTags').toArray()
    expect(joins).toHaveLength(4)

    // Inline field is preserved transiently.
    const todoA = await post.table('todos').get(1)
    expect(todoA.tags).toEqual(['urgent', 'today'])
    post.close()
  })

  it('case-folds duplicate slugs (URGENT + Urgent + urgent → one tag)', async () => {
    const pre = await openV35()
    await pre.table('todos').add({
      title: 'a', isCompleted: false, sortOrder: 0,
      tags: ['URGENT', 'Urgent', 'urgent'],
    })
    pre.close()

    const post = await openAtV36()
    const tags = await post.table('tags').toArray()
    expect(tags).toHaveLength(1)
    expect(tags[0].name).toBe('urgent')
    const joins = await post.table('todoTags').toArray()
    // Three inline occurrences → three join rows, all pointing at the same tag.
    expect(joins).toHaveLength(3)
    expect(new Set(joins.map((j) => j.tagId))).toEqual(new Set([tags[0].id]))
    post.close()
  })

  it('translates stored predicate tags from string[] to number[] via the slug→id map', async () => {
    const pre = await openV35()
    await pre.table('todos').add({
      title: 't', isCompleted: false, sortOrder: 0, tags: ['urgent'],
    })
    await pre.table('listDefinitions').add({
      name: 'Urgent list',
      sortOrder: 0,
      pinnedToDashboard: true,
      membership: {
        kind: 'custom',
        predicate: { tags: ['urgent', 'does-not-exist'] },
      },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    })
    await pre.table('savedViews').add({
      name: 'sv',
      sortBy: 'date',
      sortOrder: 0,
      filters: { tags: ['urgent'] },
    })
    pre.close()

    const post = await openAtV36()
    const urgentTag = (await post.table('tags').toArray()).find((t) => t.name === 'urgent')!
    const defs = await post.table('listDefinitions').toArray()
    expect(defs[0].membership.predicate.tags).toEqual([urgentTag.id])
    const savedViews = await post.table('savedViews').toArray()
    expect(savedViews[0].filters.tags).toEqual([urgentTag.id])
    post.close()
  })

  it('drops unknown predicate tag names with a single console warning', async () => {
    const pre = await openV35()
    await pre.table('listDefinitions').add({
      name: 'Mystery filter',
      sortOrder: 0,
      pinnedToDashboard: true,
      membership: {
        kind: 'custom',
        predicate: { tags: ['never-used'] },
      },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    })
    pre.close()

    const post = await openAtV36()
    const defs = await post.table('listDefinitions').toArray()
    expect(defs[0].membership.predicate.tags).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
    const warnMsg = (warnSpy.mock.calls[0] ?? [])[0] as string | undefined
    expect(warnMsg).toContain('never-used')
    post.close()
  })

  it('preserves todos with no inline tags untouched', async () => {
    const pre = await openV35()
    await pre.table('todos').bulkAdd([
      { title: 'plain', isCompleted: false, sortOrder: 0 },
      { title: 'tagged', isCompleted: false, sortOrder: 1, tags: ['urgent'] },
    ])
    pre.close()

    const post = await openAtV36()
    const plain = await post.table('todos').get(1)
    expect('tags' in plain).toBe(false)
    const joins = await post.table('todoTags').toArray()
    expect(joins).toHaveLength(1)
    expect(joins[0].todoId).toBe(2)
    post.close()
  })

  it('is a no-op on a v35 DB with zero inline tags', async () => {
    const pre = await openV35()
    await pre.table('todos').add({ title: 'a', isCompleted: false, sortOrder: 0 })
    pre.close()

    const post = await openAtV36()
    expect(await post.table('tags').count()).toBe(0)
    expect(await post.table('todoTags').count()).toBe(0)
    expect(warnSpy).not.toHaveBeenCalled()
    post.close()
  })

  it('runs cleanly when savedViews table is already absent (post-v39 restore chain)', async () => {
    // Simulate the restore-then-upgrade edge case: the DB's v1 schema never
    // declares `savedViews`, so `tx.table('savedViews')` inside the v36
    // upgrade throws. The defensive try/catch must swallow that so the rest
    // of v36 (tag seeding + listDefinition translation) still runs.
    const pre = new Dexie(DB_NAME)
    pre.version(1).stores({
      todos: V35_TODOS_SCHEMA,
      listDefinitions: '++id, sortOrder',
      // note: no savedViews store
    })
    await pre.open()
    await pre.table('todos').add({
      title: 't', isCompleted: false, sortOrder: 0, tags: ['urgent'],
    })
    await pre.table('listDefinitions').add({
      name: 'Urgent list',
      sortOrder: 0,
      pinnedToDashboard: true,
      membership: {
        kind: 'custom',
        predicate: { tags: ['urgent', 'does-not-exist'] },
      },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    })
    pre.close()

    const post = new Dexie(DB_NAME)
    post.version(1).stores({
      todos: V35_TODOS_SCHEMA,
      listDefinitions: '++id, sortOrder',
    })
    post.version(2)
      .stores({
        tags: '++id, name',
        todoTags: '++id, todoId, tagId',
      })
      .upgrade(async (tx) => {
        await runV36Migration(tx)
      })
    await expect(post.open()).resolves.toBeDefined()

    // Tag registry seeded + join created, despite savedViews being absent.
    const tags = await post.table('tags').toArray()
    expect(tags).toHaveLength(1)
    expect(tags[0].name).toBe('urgent')
    const joins = await post.table('todoTags').toArray()
    expect(joins).toHaveLength(1)

    // listDefinitions translation also ran.
    const defs = await post.table('listDefinitions').toArray()
    expect(defs[0].membership.predicate.tags).toEqual([tags[0].id])
    post.close()
  })
})
