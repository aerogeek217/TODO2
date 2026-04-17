import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useTagStore } from '../../stores/tag-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })
})

async function addTodo(title = 'Task'): Promise<number> {
  return (await db.todos.add({
    title, isCompleted: false,
    createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
  })) as number
}

describe('useTagStore', () => {
  it('load populates from DB', async () => {
    await db.tags.add({ name: 'urgent', color: '#ff0000' })
    await db.tags.add({ name: 'backend', color: '#0000ff' })

    await useTagStore.getState().load()
    expect(useTagStore.getState().tags).toHaveLength(2)
  })

  it('add creates tag', async () => {
    const id = await useTagStore.getState().add('urgent', '#ff0000')
    expect(useTagStore.getState().tags).toHaveLength(1)
    expect(useTagStore.getState().tags[0].name).toBe('urgent')
    expect(id).toBeGreaterThan(0)
  })

  it('update modifies in store', async () => {
    const id = await useTagStore.getState().add('urgent')
    await useTagStore.getState().update({ id, name: 'critical', color: '#00ff00' })
    expect(useTagStore.getState().tags[0].name).toBe('critical')
  })

  it('remove deletes from store', async () => {
    const id = await useTagStore.getState().add('urgent')
    await useTagStore.getState().remove(id)
    expect(useTagStore.getState().tags).toHaveLength(0)
  })

  it('loadAssignments populates assignedTagsMap', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await db.todoTags.add({ todoId, tagId } as any)

    await useTagStore.getState().loadAssignments([todoId])
    const map = useTagStore.getState().assignedTagsMap
    expect(map.get(todoId)).toHaveLength(1)
    expect(map.get(todoId)![0].name).toBe('urgent')
  })

  it('assignTag adds to map and DB', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])

    await useTagStore.getState().assignTag(todoId, tagId)
    expect(useTagStore.getState().assignedTagsMap.get(todoId)).toHaveLength(1)
  })

  it('unassignTag removes from map and DB', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])
    await useTagStore.getState().assignTag(todoId, tagId)

    await useTagStore.getState().unassignTag(todoId, tagId)
    expect(useTagStore.getState().assignedTagsMap.get(todoId) ?? []).toHaveLength(0)
  })

  it('update propagates changes into assignedTagsMap entries', async () => {
    const tagId = await useTagStore.getState().add('urgent', '#ff0000')
    const todoId = await addTodo()
    await useTagStore.getState().loadAssignments([todoId])
    await useTagStore.getState().assignTag(todoId, tagId)

    await useTagStore.getState().update({ id: tagId, name: 'critical', color: '#00ff00' })
    const assigned = useTagStore.getState().assignedTagsMap.get(todoId)!
    expect(assigned[0].name).toBe('critical')
    expect(assigned[0].color).toBe('#00ff00')
  })

  it('bulkAssignTag assigns to multiple todos', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const t1 = await addTodo('Task 1')
    const t2 = await addTodo('Task 2')
    await useTagStore.getState().loadAssignments([t1, t2])

    await useTagStore.getState().bulkAssignTag([t1, t2], tagId)
    const links = await db.todoTags.toArray()
    expect(links).toHaveLength(2)
  })

  it('bulkUnassignTag unassigns from multiple todos', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const t1 = await addTodo('Task 1')
    const t2 = await addTodo('Task 2')
    await useTagStore.getState().loadAssignments([t1, t2])
    await useTagStore.getState().assignTag(t1, tagId)
    await useTagStore.getState().assignTag(t2, tagId)

    await useTagStore.getState().bulkUnassignTag([t1, t2], tagId)
    const links = await db.todoTags.toArray()
    expect(links).toHaveLength(0)
  })
})
