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

describe('undo of an entity delete when the name was created again meanwhile', () => {
  it('a person: the original comes back (id, colour, email, tasks) and takes over the new one’s tasks — no second "Ann"', async () => {
    const t1 = await seedTask('one')
    const t2 = await seedTask('two')
    const t3 = await seedTask('three')
    const ann = await usePersonStore.getState().add('Ann', 'A', '#ff0000', 'ann@example.com')
    await usePersonStore.getState().assignPerson(t1, ann)
    await usePersonStore.getState().assignPerson(t3, ann)
    await usePersonStore.getState().loadAssignments(useTodoStore.getState().todos.map((t) => t.id))
    await usePersonStore.getState().remove(ann)

    // `@ann` typed meanwhile: a new person, on t2 and t3 (written straight, so the delete stays the newest undo step).
    const again = await usePersonStore.getState().getOrCreate('ann')
    expect(again).not.toBe(ann)
    await db.todoPeople.bulkAdd([{ todoId: t2, personId: again }, { todoId: t3, personId: again }])

    await useUndoStore.getState().undo()
    const people = await db.people.toArray()
    expect(people).toEqual([expect.objectContaining({ id: ann, name: 'Ann', color: '#ff0000', email: 'ann@example.com' })])
    expect(usePersonStore.getState().people.map((p) => p.id)).toEqual([ann])
    const joins = await db.todoPeople.toArray()
    expect(joins.map((j) => [j.todoId, j.personId]).sort()).toEqual([[t1, ann], [t2, ann], [t3, ann]].sort())
    expect(usePersonStore.getState().assignedPeopleMap.get(t2)?.map((p) => p.id)).toEqual([ann])
  })

  it('a tag: the original comes back and takes over the new one’s tasks — no second "work"', async () => {
    const t1 = await seedTask('one')
    const t2 = await seedTask('two')
    const work = await useTagStore.getState().add('work', '#00ff00')
    await useTagStore.getState().assignTag(t1, work)
    await useTagStore.getState().loadAssignments(useTodoStore.getState().todos.map((t) => t.id))
    await useTagStore.getState().remove(work)

    const again = await useTagStore.getState().add('Work')
    expect(again).not.toBe(work)
    await db.todoTags.bulkAdd([{ todoId: t1, tagId: again }, { todoId: t2, tagId: again }])

    await useUndoStore.getState().undo()
    expect(await db.tags.toArray()).toEqual([expect.objectContaining({ id: work, name: 'work', color: '#00ff00' })])
    expect(useTagStore.getState().tags.map((t) => t.id)).toEqual([work])
    const joins = await db.todoTags.toArray()
    expect(joins.map((j) => [j.todoId, j.tagId]).sort()).toEqual([[t1, work], [t2, work]].sort())
  })
})
