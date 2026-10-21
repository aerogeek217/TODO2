// Undoing a create and redoing it puts the task back as it was when the
// undo ran — its people, tags, list ranks and row — not as it was created:
// changes made after the create without an undo step of their own (a manual
// order move, a sync-file load) survive the round trip, as for a delete.
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
import { resetStores } from '../store-tracking'

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
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
  it('add: redo brings back the people, tags, ranks and row the task had when undone', async () => {
    const id = await useTodoStore.getState().add('Milk')
    await changeWithoutUndo(id)

    await useUndoStore.getState().undo()
    expect(await db.todos.get(id)).toBeUndefined()
    expect(await db.listOrders.count()).toBe(0)
    await useUndoStore.getState().redo()

    await expectAsChanged(id)
  })

  it('duplicate: the copy keeps the source’s people and tags, and redo brings back what it had when undone', async () => {
    const source = await useTodoStore.getState().add('Source')
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
