// Undoing a create and redoing it puts the task back as it was when the
// undo ran — its people, tags, list ranks and row — not as it was created:
// changes made after the create without an undo step of their own (a manual
// order move, a sync-file load) survive the round trip, as for a delete. A
// delete's redo likewise captures afresh for the next undo (cr31 stores L3,
// L4: every path runs through `todo-store`'s one take / put-back).
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { personRepository } from '../../data/person-repository'
import { tagRepository } from '../../data/tag-repository'
import { todoRepository } from '../../data/todo-repository'
import { useListOrderStore } from '../../stores/list-order-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { emptyPredicate } from '../../models/filter-predicate'
import { resetStores } from '../store-tracking'
import { addTask } from '../add-task'

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
  // List 7, a manual-order list: ranks come back only for a list that exists.
  await db.listDefinitions.add({
    id: 7, name: 'Manual', sortOrder: 0, sort: 'manual', grouping: 'none',
    membership: { kind: 'custom', predicate: emptyPredicate() },
    owner: { layoutId: 1 },
  })
})

/**
 * Changes task `id` the way a write with no undo step does (a sync-file
 * load): a person, a tag and a title in the database, read back by the
 * stores; plus a manual-order rank in list 7.
 */
async function changeWithoutUndo(id: number) {
  const ann = await db.people.add({ name: 'Ann', initials: 'AN' }) as number
  const home = await db.tags.add({ name: 'home', color: '#000' }) as number
  await personRepository.assignPerson(id, ann)
  await tagRepository.assignTag(id, home)
  await todoRepository.update(id, { title: 'Renamed' })
  await usePersonStore.getState().load()
  await useTagStore.getState().load()
  await useTodoStore.getState().loadAll()
  await usePersonStore.getState().loadAssignments([id], { refetch: true })
  await useTagStore.getState().loadAssignments([id], { refetch: true })
  await useListOrderStore.getState().setRanks(7, [{ todoId: id, rank: 3 }])
}

async function expectAsChanged(id: number) {
  expect((await db.todos.get(id))?.title).toBe('Renamed')
  expect(useTodoStore.getState().todos.find((t) => t.id === id)?.title).toBe('Renamed')
  expect((await db.todoPeople.where('todoId').equals(id).toArray()).length).toBe(1)
  expect((await db.todoTags.where('todoId').equals(id).toArray()).length).toBe(1)
  expect(usePersonStore.getState().assignedPeopleMap.get(id)?.map((p) => p.name)).toEqual(['Ann'])
  expect(useTagStore.getState().assignedTagsMap.get(id)?.map((t) => t.name)).toEqual(['home'])
  expect((await db.listOrders.where('todoId').equals(id).toArray()).map((r) => r.rank)).toEqual([3])
  expect(useListOrderStore.getState().ranks.get(7)?.get(id)).toBe(3)
  expect((await db.todoEvents.where('todoId').equals(id).toArray()).map((e) => e.type)).toContain('created')
}

describe('undo → redo of a create', () => {
  it('a create through addMany (Quick Add, the editor, notes): redo brings back the rank it was dragged to', async () => {
    const [a, b] = await useTodoStore.getState().addMany([
      { todo: { title: 'Milk', isCompleted: false, createdAt: new Date(), modifiedAt: new Date() }, personIds: [], tagIds: [] },
      { todo: { title: 'Eggs', isCompleted: false, createdAt: new Date(), modifiedAt: new Date() }, personIds: [], tagIds: [] },
    ], { description: 'Add 2 tasks' })
    await useListOrderStore.getState().setRanks(7, [{ todoId: a!, rank: 1 }, { todoId: b!, rank: 0 }])

    await useUndoStore.getState().undo()
    expect(await db.todos.count()).toBe(0)
    expect(await db.listOrders.count()).toBe(0)
    expect(useListOrderStore.getState().ranks.get(7)).toBeUndefined()
    await useUndoStore.getState().redo()

    expect((await db.listOrders.where('todoId').equals(a!).toArray()).map((r) => r.rank)).toEqual([1])
    expect(useListOrderStore.getState().ranks.get(7)?.get(a!)).toBe(1)
    expect(useListOrderStore.getState().ranks.get(7)?.get(b!)).toBe(0)
    expect(useTodoStore.getState().todos.map((t) => t.title).sort()).toEqual(['Eggs', 'Milk'])
  })

  it('add: redo brings back the people, tags, ranks and row the task had when undone', async () => {
    const id = await addTask('Milk')
    await changeWithoutUndo(id)

    await useUndoStore.getState().undo()
    expect(await db.todos.get(id)).toBeUndefined()
    expect(await db.listOrders.count()).toBe(0)
    await useUndoStore.getState().redo()

    await expectAsChanged(id)
  })

  it('duplicate: the copy keeps the source’s people and tags, and redo brings back what it had when undone', async () => {
    const source = await addTask('Source')
    const bob = await db.people.add({ name: 'Bob', initials: 'BO' }) as number
    await usePersonStore.getState().load()
    await usePersonStore.getState().loadAssignments([source])
    await usePersonStore.getState().assignPerson(source, bob)

    const copy = (await useTodoStore.getState().duplicate(source))!
    expect((await db.todoPeople.where('todoId').equals(copy).toArray()).map((r) => r.personId)).toEqual([bob])
    expect(usePersonStore.getState().assignedPeopleMap.get(copy)?.map((p) => p.name)).toEqual(['Bob'])

    await personRepository.unassignPerson(copy, bob)
    await changeWithoutUndo(copy)
    await useUndoStore.getState().undo()
    expect(await db.todos.get(copy)).toBeUndefined()
    await useUndoStore.getState().redo()

    await expectAsChanged(copy)
  })
})

describe('undo → redo → undo of a delete', () => {
  it('remove: the second undo brings back the rank the task had when redone', async () => {
    const id = await addTask('Milk')
    await useListOrderStore.getState().setRanks(7, [{ todoId: id, rank: 1 }])
    await useTodoStore.getState().remove(id)
    await useUndoStore.getState().undo()
    await useListOrderStore.getState().setRanks(7, [{ todoId: id, rank: 9 }])

    await useUndoStore.getState().redo()
    expect(await db.todos.get(id)).toBeUndefined()
    await useUndoStore.getState().undo()

    expect((await db.listOrders.where('todoId').equals(id).toArray()).map((r) => r.rank)).toEqual([9])
    expect(useListOrderStore.getState().ranks.get(7)?.get(id)).toBe(9)
  })

  it('bulkRemove: the second undo brings back the ranks and row the tasks had when redone', async () => {
    const a = await addTask('A')
    const b = await addTask('B')
    await useListOrderStore.getState().setRanks(7, [{ todoId: a, rank: 1 }, { todoId: b, rank: 2 }])
    await useTodoStore.getState().bulkRemove([a, b])
    await useUndoStore.getState().undo()
    await useListOrderStore.getState().setRanks(7, [{ todoId: a, rank: 5 }])
    await todoRepository.update(b, { title: 'B renamed' })
    await useTodoStore.getState().loadAll()

    await useUndoStore.getState().redo()
    expect(await db.todos.count()).toBe(0)
    await useUndoStore.getState().undo()

    expect(useListOrderStore.getState().ranks.get(7)?.get(a)).toBe(5)
    expect(useListOrderStore.getState().ranks.get(7)?.get(b)).toBe(2)
    expect((await db.todos.get(b))?.title).toBe('B renamed')
    expect(useTodoStore.getState().todos.find((t) => t.id === b)?.title).toBe('B renamed')
  })

  it('bulkRemove: a task not loaded in the store is deleted and its undo brings it back', async () => {
    const a = await addTask('A')
    const stray = await todoRepository.insert({ title: 'Not loaded', isCompleted: false, createdAt: new Date(), modifiedAt: new Date() })
    await useTodoStore.getState().bulkRemove([a, stray])
    expect(await db.todos.get(stray)).toBeUndefined()
    await useUndoStore.getState().undo()

    expect((await db.todos.get(stray))?.title).toBe('Not loaded')
    expect(useTodoStore.getState().todos.map((t) => t.id).sort()).toEqual([a, stray].sort())
  })
})

describe('undo of a delete after its list went', () => {
  it('writes no rank for a list deleted meanwhile (cr31 L8)', async () => {
    const id = await addTask('Milk')
    await useListOrderStore.getState().setRanks(7, [{ todoId: id, rank: 1 }])
    await useTodoStore.getState().remove(id)
    // The list goes with its layout (no undo step of its own).
    await db.listDefinitions.delete(7)
    await useUndoStore.getState().undo()
    expect(await db.todos.get(id)).toBeDefined()
    expect(await db.listOrders.count()).toBe(0)
    expect(useListOrderStore.getState().ranks.get(7)).toBeUndefined()
  })
})

