import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function seedTask(title: string): Promise<number> {
  await useTodoStore.getState().loadAll()
  return useTodoStore.getState().add(title)
}

describe('undo of an entity delete puts its assignments back on the loaded tasks', () => {
  it('a person', async () => {
    const t1 = await seedTask('one')
    const t2 = await seedTask('two')
    const ann = await usePersonStore.getState().add('Ann', 'A')
    await usePersonStore.getState().assignPerson(t1, ann)
    const ids = useTodoStore.getState().todos.map((t) => t.id)
    await usePersonStore.getState().loadAssignments(ids)
    expect(usePersonStore.getState().assignedPeopleMap.get(t1)?.map((p) => p.name)).toEqual(['Ann'])

    await usePersonStore.getState().remove(ann)
    expect(usePersonStore.getState().assignedPeopleMap.get(t1)).toEqual([])

    await useUndoStore.getState().undo()
    expect(usePersonStore.getState().people.map((p) => p.name)).toEqual(['Ann'])
    expect(usePersonStore.getState().assignedPeopleMap.get(t1)?.map((p) => p.name)).toEqual(['Ann'])
    expect(usePersonStore.getState().assignedPeopleMap.get(t2)).toEqual([])
  })

  it('a tag', async () => {
    const t1 = await seedTask('one')
    const t2 = await seedTask('two')
    const tagId = await useTagStore.getState().add('work')
    await useTagStore.getState().assignTag(t1, tagId)
    const ids = useTodoStore.getState().todos.map((t) => t.id)
    await useTagStore.getState().loadAssignments(ids)
    expect(useTagStore.getState().assignedTagsMap.get(t1)?.map((t) => t.name)).toEqual(['work'])

    await useTagStore.getState().remove(tagId)
    expect(useTagStore.getState().assignedTagsMap.get(t1) ?? []).toEqual([])

    await useUndoStore.getState().undo()
    expect(useTagStore.getState().tags.map((t) => t.name)).toEqual(['work'])
    expect(useTagStore.getState().assignedTagsMap.get(t1)?.map((t) => t.name)).toEqual(['work'])
    expect(useTagStore.getState().assignedTagsMap.get(t2) ?? []).toEqual([])
  })
})
