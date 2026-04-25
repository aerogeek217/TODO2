import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { usePersonStore } from '../../stores/person-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map(), loading: false, error: null })
})

async function addTodo(title = 'Task'): Promise<number> {
  return (await db.todos.add({
    title, isCompleted: false,
    createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
  })) as number
}

describe('usePersonStore', () => {
  it('load populates from DB', async () => {
    await db.people.add({ name: 'Alice', initials: 'A' })
    await db.people.add({ name: 'Bob', initials: 'B' })

    await usePersonStore.getState().load()
    expect(usePersonStore.getState().people).toHaveLength(2)
  })

  it('add creates person', async () => {
    const id = await usePersonStore.getState().add('Alice', 'A')
    expect(usePersonStore.getState().people).toHaveLength(1)
    expect(usePersonStore.getState().people[0]!.name).toBe('Alice')
    expect(id).toBeGreaterThan(0)
  })

  it('update modifies in store', async () => {
    const id = await usePersonStore.getState().add('Alice', 'A')
    await usePersonStore.getState().update({ id, name: 'Alice Smith', initials: 'AS' })
    expect(usePersonStore.getState().people[0]!.name).toBe('Alice Smith')
  })

  it('remove deletes from store', async () => {
    const id = await usePersonStore.getState().add('Alice', 'A')
    await usePersonStore.getState().remove(id)
    expect(usePersonStore.getState().people).toHaveLength(0)
  })

  it('remove prunes the deleted person from assignedPeopleMap', async () => {
    const aliceId = await usePersonStore.getState().add('Alice', 'A')
    const bobId = await usePersonStore.getState().add('Bob', 'B')
    const todoId = await addTodo()
    await usePersonStore.getState().loadAssignments([todoId])
    await usePersonStore.getState().assignPerson(todoId, aliceId)
    await usePersonStore.getState().assignPerson(todoId, bobId)
    expect(usePersonStore.getState().assignedPeopleMap.get(todoId)).toHaveLength(2)

    await usePersonStore.getState().remove(aliceId)
    const remaining = usePersonStore.getState().assignedPeopleMap.get(todoId) ?? []
    expect(remaining.map((p) => p.id)).toEqual([bobId])
  })

  it('loadAssignments populates assignedPeopleMap', async () => {
    const personId = await usePersonStore.getState().add('Alice', 'A')
    const todoId = await addTodo()
    await db.todoPeople.add({ todoId, personId } as any)

    await usePersonStore.getState().loadAssignments([todoId])
    const map = usePersonStore.getState().assignedPeopleMap
    expect(map.get(todoId)).toHaveLength(1)
    expect(map.get(todoId)![0]!.name).toBe('Alice')
  })

  it('assignPerson adds to map and DB', async () => {
    const personId = await usePersonStore.getState().add('Alice', 'A')
    const todoId = await addTodo()
    await usePersonStore.getState().loadAssignments([todoId])

    await usePersonStore.getState().assignPerson(todoId, personId)
    expect(usePersonStore.getState().assignedPeopleMap.get(todoId)).toHaveLength(1)
  })

  it('assignPerson is idempotent', async () => {
    const personId = await usePersonStore.getState().add('Alice', 'A')
    const todoId = await addTodo()
    await usePersonStore.getState().loadAssignments([todoId])

    await usePersonStore.getState().assignPerson(todoId, personId)
    await usePersonStore.getState().assignPerson(todoId, personId)
    const links = await db.todoPeople.where('todoId').equals(todoId).toArray()
    expect(links).toHaveLength(1)
  })

  it('unassignPerson removes from map and DB', async () => {
    const personId = await usePersonStore.getState().add('Alice', 'A')
    const todoId = await addTodo()
    await usePersonStore.getState().loadAssignments([todoId])
    await usePersonStore.getState().assignPerson(todoId, personId)

    await usePersonStore.getState().unassignPerson(todoId, personId)
    expect(usePersonStore.getState().assignedPeopleMap.get(todoId) ?? []).toHaveLength(0)
  })

  it('bulkAssignPerson assigns only to unassigned todos', async () => {
    const personId = await usePersonStore.getState().add('Alice', 'A')
    const t1 = await addTodo('Task 1')
    const t2 = await addTodo('Task 2')
    await usePersonStore.getState().loadAssignments([t1, t2])

    // Pre-assign t1
    await usePersonStore.getState().assignPerson(t1, personId)

    await usePersonStore.getState().bulkAssignPerson([t1, t2], personId)
    // Both should now be assigned, but only one DB link for t1
    const links = await db.todoPeople.toArray()
    expect(links).toHaveLength(2) // one for t1, one for t2
  })

  it('bulkUnassignPerson unassigns only from assigned todos', async () => {
    const personId = await usePersonStore.getState().add('Alice', 'A')
    const t1 = await addTodo('Task 1')
    const t2 = await addTodo('Task 2')
    await usePersonStore.getState().loadAssignments([t1, t2])
    await usePersonStore.getState().assignPerson(t1, personId)

    await usePersonStore.getState().bulkUnassignPerson([t1, t2], personId)
    const links = await db.todoPeople.toArray()
    expect(links).toHaveLength(0)
  })
})
