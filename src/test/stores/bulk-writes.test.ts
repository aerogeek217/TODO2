import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'

/**
 * A bulk write that fails part-way leaves the store as the database has it:
 * the write is one transaction, so a failure on one task stores nothing.
 */

const unhooks: Array<() => void> = []

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  for (const unhook of unhooks.splice(0)) unhook()
  vi.restoreAllMocks()
})

/** Makes the database refuse one row's write (an `updating` / `creating` hook that throws). */
function refuseTodoUpdate(todoId: number) {
  const hook = (_mods: object, key: unknown) => {
    if (key === todoId) throw new Error('disk full')
  }
  db.todos.hook('updating', hook)
  unhooks.push(() => db.todos.hook('updating').unsubscribe(hook))
}

function refuseJoinCreate(table: typeof db.todoPeople | typeof db.todoTags, todoId: number) {
  const hook = (_key: unknown, row: { todoId: number }) => {
    if (row.todoId === todoId) throw new Error('disk full')
  }
  table.hook('creating', hook)
  unhooks.push(() => table.hook('creating').unsubscribe(hook))
}

async function threeTasks() {
  const ids = [
    await useTodoStore.getState().add('One'),
    await useTodoStore.getState().add('Two'),
    await useTodoStore.getState().add('Three'),
  ]
  useUndoStore.setState(useUndoStore.getInitialState(), true)
  return ids as [number, number, number]
}

describe('bulk writes that fail part-way', () => {
  it('bulkSetCompleted: one task refused → none completed, in the store and the database, and no undo entry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ids = await threeTasks()
    refuseTodoUpdate(ids[1])

    await expect(useTodoStore.getState().bulkSetCompleted(ids, true)).rejects.toThrow()

    const stored = await db.todos.bulkGet(ids)
    expect(stored.map((t) => t?.isCompleted)).toEqual([false, false, false])
    expect(useTodoStore.getState().todos.map((t) => t.isCompleted)).toEqual([false, false, false])
    expect(await db.todoEvents.where('type').equals('completed').count()).toBe(0)
    expect(useUndoStore.getState().undoStack).toEqual([])
  })

  it('bulkSetCompleted: written as one transaction, undone as one', async () => {
    const ids = await threeTasks()
    await useTodoStore.getState().bulkSetCompleted(ids, true)
    expect((await db.todos.bulkGet(ids)).map((t) => t?.isCompleted)).toEqual([true, true, true])
    expect(await db.todoEvents.where('type').equals('completed').count()).toBe(3)

    await useUndoStore.getState().undo()
    expect((await db.todos.bulkGet(ids)).map((t) => t?.isCompleted)).toEqual([false, false, false])
    expect(useTodoStore.getState().todos.map((t) => t.isCompleted)).toEqual([false, false, false])
    expect(await db.todoEvents.where('type').equals('reopened').count()).toBe(3)

    // Undoing an "Uncomplete" re-completes with the original completion time.
    await useUndoStore.getState().redo()
    const completedAt = (await db.todos.get(ids[0]))!.completedAt!.getTime()
    await useTodoStore.getState().bulkSetCompleted(ids, false)
    await useUndoStore.getState().undo()
    expect((await db.todos.get(ids[0]))!.completedAt!.getTime()).toBe(completedAt)
    expect(useTodoStore.getState().todos[0]!.completedAt!.getTime()).toBe(completedAt)
  })

  it('bulkAssignPerson: one task refused → nobody assigned, in the store and the database', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ann = await db.people.add({ name: 'Ann', initials: 'AN' }) as number
    await usePersonStore.getState().load()
    const ids = await threeTasks()
    await usePersonStore.getState().loadAssignments(ids)
    refuseJoinCreate(db.todoPeople, ids[1])

    await expect(usePersonStore.getState().bulkAssignPerson(ids, ann)).rejects.toThrow()

    expect(await db.todoPeople.count()).toBe(0)
    const map = usePersonStore.getState().assignedPeopleMap
    expect(ids.map((id) => map.get(id)?.length ?? 0)).toEqual([0, 0, 0])
  })

  it('bulkAssignTag / bulkUnassignTag: one transaction each, a task that has it already is left alone', async () => {
    const home = await db.tags.add({ name: 'home', color: '#000' }) as number
    await useTagStore.getState().load()
    const ids = await threeTasks()
    await useTagStore.getState().loadAssignments(ids)
    await useTagStore.getState().assignTag(ids[0], home)

    await useTagStore.getState().bulkAssignTag(ids, home)
    expect(await db.todoTags.where('tagId').equals(home).count()).toBe(3)

    await useTagStore.getState().bulkUnassignTag(ids, home)
    expect(await db.todoTags.count()).toBe(0)
    const map = useTagStore.getState().assignedTagsMap
    expect(ids.map((id) => map.get(id)?.length ?? 0)).toEqual([0, 0, 0])
  })

  it('bulkUnassignTag: one task refused → every tag stays, in the store and the database', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const home = await db.tags.add({ name: 'home', color: '#000' }) as number
    await useTagStore.getState().load()
    const ids = await threeTasks()
    await useTagStore.getState().loadAssignments(ids)
    await useTagStore.getState().bulkAssignTag(ids, home)
    const hook = (key: unknown, row: { todoId: number }) => {
      void key
      if (row.todoId === ids[1]) throw new Error('disk full')
    }
    db.todoTags.hook('deleting', hook)
    unhooks.push(() => db.todoTags.hook('deleting').unsubscribe(hook))

    await expect(useTagStore.getState().bulkUnassignTag(ids, home)).rejects.toThrow()

    expect(await db.todoTags.count()).toBe(3)
    const map = useTagStore.getState().assignedTagsMap
    expect(ids.map((id) => map.get(id)?.length ?? 0)).toEqual([1, 1, 1])
  })
})
