import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useTagStore, TagLimitError } from '../../stores/tag-store'
import { useSettingsStore } from '../../stores/settings-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })
  useSettingsStore.setState({ maxTags: 500 })
})

async function addTodo(title = 'Task'): Promise<number> {
  return (await db.todos.add({
    title, isCompleted: false,
    createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
  })) as number
}

describe('useTagStore', () => {
  it('load populates tags from DB', async () => {
    await db.tags.add({ name: 'urgent', color: '#ff0000' })
    await db.tags.add({ name: 'today', color: '#00ff00' })

    await useTagStore.getState().load()
    expect(useTagStore.getState().tags).toHaveLength(2)
  })

  it('add inserts tag with default color when none provided', async () => {
    const id = await useTagStore.getState().add('urgent')
    const tags = useTagStore.getState().tags
    expect(tags).toHaveLength(1)
    expect(tags[0]!.name).toBe('urgent')
    expect(tags[0]!.color).toBe('#537FE7')
    expect(id).toBeGreaterThan(0)
  })

  it('add respects explicit color', async () => {
    await useTagStore.getState().add('urgent', '#ff0000')
    expect(useTagStore.getState().tags[0]!.color).toBe('#ff0000')
  })

  it('add throws TagLimitError when tags.length >= settings.maxTags', async () => {
    useSettingsStore.setState({ maxTags: 2 })
    await useTagStore.getState().add('one')
    await useTagStore.getState().add('two')
    await expect(useTagStore.getState().add('three')).rejects.toBeInstanceOf(TagLimitError)
    await expect(useTagStore.getState().add('three')).rejects.toThrow(/tag limit/i)
    // Store state unchanged beyond the configured ceiling.
    expect(useTagStore.getState().tags).toHaveLength(2)
    // No row persisted to the registry either.
    expect(await db.tags.count()).toBe(2)
  })

  it('add is idempotent — returns existing id on case-insensitive match', async () => {
    // Post-M1, `add` is resolve-or-create: duplicate creates no longer throw,
    // they return the existing id. Keeps the registry free of races from
    // concurrent NLP calls (see concurrent test below). Explicit UI-level
    // duplicate-rejection lives in `TagEditor` via a pre-check on `tags[]`.
    const aId = await useTagStore.getState().add('urgent')
    const bId = await useTagStore.getState().add('URGENT')
    const cId = await useTagStore.getState().add('Urgent')
    expect(bId).toBe(aId)
    expect(cId).toBe(aId)
    expect(useTagStore.getState().tags).toHaveLength(1)
    expect(await db.tags.count()).toBe(1)
  })

  it('concurrent add for the same name resolves to one id with no duplicate rows', async () => {
    // Simulates two NLP pipelines racing to create `#foo` — the tag-repository
    // transaction serialises them so exactly one row lands in `db.tags`.
    const [id1, id2, id3] = await Promise.all([
      useTagStore.getState().add('foo'),
      useTagStore.getState().add('foo'),
      useTagStore.getState().add('FOO'),
    ])
    expect(id1).toBe(id2)
    expect(id2).toBe(id3)
    expect(await db.tags.count()).toBe(1)
    expect(useTagStore.getState().tags).toHaveLength(1)
  })

  it('update modifies tag in store array', async () => {
    const id = await useTagStore.getState().add('urgent')
    await useTagStore.getState().update({ id, name: 'critical', color: '#ff00ff' })
    const tags = useTagStore.getState().tags
    expect(tags[0]!.name).toBe('critical')
    expect(tags[0]!.color).toBe('#ff00ff')
  })

  it('update refreshes tag references inside assignedTagsMap', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])
    await useTagStore.getState().assignTag(todoId, tagId)
    expect(useTagStore.getState().assignedTagsMap.get(todoId)![0]!.name).toBe('urgent')

    await useTagStore.getState().update({ id: tagId, name: 'critical', color: '#ff00ff' })
    expect(useTagStore.getState().assignedTagsMap.get(todoId)![0]!.name).toBe('critical')
  })

  it('update rejects a rename that collides with another tag', async () => {
    const aId = await useTagStore.getState().add('urgent')
    await useTagStore.getState().add('critical')
    await expect(useTagStore.getState().update({ id: aId, name: 'CRITICAL', color: '#000' })).rejects.toThrow(/already exists/i)
  })

  it('remove deletes from store array and cascades todoTags rows', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])
    await useTagStore.getState().assignTag(todoId, tagId)
    expect(await db.todoTags.count()).toBe(1)

    await useTagStore.getState().remove(tagId)
    expect(useTagStore.getState().tags).toHaveLength(0)
    expect(await db.todoTags.count()).toBe(0)
  })

  it('remove prunes the deleted tag from assignedTagsMap', async () => {
    const urgentId = await useTagStore.getState().add('urgent')
    const todayId = await useTagStore.getState().add('today')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])
    await useTagStore.getState().assignTag(todoId, urgentId)
    await useTagStore.getState().assignTag(todoId, todayId)
    expect(useTagStore.getState().assignedTagsMap.get(todoId)).toHaveLength(2)

    await useTagStore.getState().remove(urgentId)
    const remaining = useTagStore.getState().assignedTagsMap.get(todoId) ?? []
    expect(remaining.map((t) => t.id)).toEqual([todayId])
  })

  it('loadAssignments populates assignedTagsMap', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await db.todoTags.add({ todoId, tagId })

    await useTagStore.getState().loadAssignments([todoId])
    const map = useTagStore.getState().assignedTagsMap
    expect(map.get(todoId)).toHaveLength(1)
    expect(map.get(todoId)![0]!.name).toBe('urgent')
  })

  it('assignTag adds to assignedTagsMap and persists', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])

    await useTagStore.getState().assignTag(todoId, tagId)
    expect(useTagStore.getState().assignedTagsMap.get(todoId)).toHaveLength(1)
    expect(await db.todoTags.count()).toBe(1)
  })

  it('assignTag is a no-op when the tag is already assigned', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])
    await useTagStore.getState().assignTag(todoId, tagId)
    await useTagStore.getState().assignTag(todoId, tagId)
    expect(useTagStore.getState().assignedTagsMap.get(todoId)).toHaveLength(1)
    expect(await db.todoTags.count()).toBe(1)
  })

  it('unassignTag removes from assignedTagsMap and deletes the join row', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])
    await useTagStore.getState().assignTag(todoId, tagId)

    await useTagStore.getState().unassignTag(todoId, tagId)
    expect(useTagStore.getState().assignedTagsMap.get(todoId) ?? []).toHaveLength(0)
    expect(await db.todoTags.count()).toBe(0)
  })

  it('getAssignedTags returns tags for a todoId, empty array if none', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])
    await useTagStore.getState().assignTag(todoId, tagId)

    expect(useTagStore.getState().getAssignedTags(todoId)).toHaveLength(1)
    expect(useTagStore.getState().getAssignedTags(99999)).toEqual([])
  })

  it('assignment map survives a tag-store reload (round-trip via DB)', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])
    await useTagStore.getState().assignTag(todoId, tagId)

    // Simulate a fresh load — reset in-memory state, then reload.
    useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
    await useTagStore.getState().load()
    await useTagStore.getState().loadAssignments([todoId])
    expect(useTagStore.getState().assignedTagsMap.get(todoId)).toHaveLength(1)
    expect(useTagStore.getState().assignedTagsMap.get(todoId)![0]!.name).toBe('urgent')
  })
})
