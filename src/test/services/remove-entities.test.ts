import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { backupScheduler } from '../../data/backup-scheduler'
import { removePeopleAndTags } from '../../services/remove-entities'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { makeTodo, resetDb } from '../helpers'

async function seed() {
  await db.todos.bulkAdd([makeTodo({ id: 1, title: 'Open' }), makeTodo({ id: 2, title: 'Done', isCompleted: true })])
  await db.people.bulkAdd([{ id: 1, name: 'Ann', initials: 'AN' }, { id: 2, name: 'Bob', initials: 'BO', color: '#123456' }])
  await db.tags.bulkAdd([{ id: 10, name: 'old', color: '#f00' }, { id: 11, name: 'keep', color: '#0f0' }])
  await db.todoPeople.bulkAdd([{ todoId: 2, personId: 1 }, { todoId: 1, personId: 2 }])
  await db.todoTags.bulkAdd([{ todoId: 2, tagId: 10 }, { todoId: 1, tagId: 11 }])
  await Promise.all([useTodoStore.getState().loadAll(), usePersonStore.getState().load(), useTagStore.getState().load()])
  await usePersonStore.getState().loadAssignments([1, 2])
  await useTagStore.getState().loadAssignments([1, 2])
}

beforeEach(async () => {
  await resetDb()
  vi.spyOn(backupScheduler, 'snapshotBeforeDestructive').mockResolvedValue(undefined as never)
  await seed()
})

afterEach(() => { vi.restoreAllMocks() })

describe('removePeopleAndTags', () => {
  it('removes the people and tags with their assignments, as one undo step with the snackbar', async () => {
    expect(await removePeopleAndTags([1], [10])).toBe(true)

    expect((await db.people.toArray()).map((p) => p.name)).toEqual(['Bob'])
    expect((await db.tags.toArray()).map((t) => t.name)).toEqual(['keep'])
    expect(await db.todoPeople.where('personId').equals(1).count()).toBe(0)
    expect(await db.todoTags.where('tagId').equals(10).count()).toBe(0)
    expect(usePersonStore.getState().people.map((p) => p.name)).toEqual(['Bob'])
    expect(useTagStore.getState().tags.map((t) => t.name)).toEqual(['keep'])
    expect(usePersonStore.getState().assignedPeopleMap.get(2)).toEqual([])
    expect(useTagStore.getState().assignedTagsMap.get(2)).toEqual([])

    const undo = useUndoStore.getState()
    expect(undo.undoStack).toHaveLength(1)
    expect(undo.undoStack[0]?.description).toBe('Remove 1 person and 1 tag')
    expect(undo.snackbar?.description).toBe('Remove 1 person and 1 tag')
  })

  it('Undo brings every row back with its id and its assignments; Redo removes them again', async () => {
    const joinsBefore = { people: await db.todoPeople.toArray(), tags: await db.todoTags.toArray() }
    await removePeopleAndTags([1], [10])
    await useUndoStore.getState().undo()

    expect(await db.people.get(1)).toEqual({ id: 1, name: 'Ann', initials: 'AN' })
    expect(await db.tags.get(10)).toEqual({ id: 10, name: 'old', color: '#f00' })
    expect(await db.todoPeople.toArray()).toEqual(expect.arrayContaining(joinsBefore.people))
    expect(await db.todoTags.toArray()).toEqual(expect.arrayContaining(joinsBefore.tags))
    expect(usePersonStore.getState().people.map((p) => p.id).sort()).toEqual([1, 2])
    expect(useTagStore.getState().tags.map((t) => t.id).sort()).toEqual([10, 11])
    expect(usePersonStore.getState().assignedPeopleMap.get(2)?.map((p) => p.id)).toEqual([1])
    expect(useTagStore.getState().assignedTagsMap.get(2)?.map((t) => t.id)).toEqual([10])

    await useUndoStore.getState().redo()
    expect(await db.people.get(1)).toBeUndefined()
    expect(await db.tags.get(10)).toBeUndefined()
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('Undo after a Redo restores what the Redo removed: an assignment made between Undo and Redo comes back', async () => {
    await removePeopleAndTags([1], [10])
    await useUndoStore.getState().undo()
    const newTodo = await db.todos.add(makeTodo({ id: 3, title: 'New' }))
    await db.todoPeople.add({ todoId: newTodo, personId: 1 })

    await useUndoStore.getState().redo()
    expect(await db.todoPeople.where('personId').equals(1).count()).toBe(0)
    expect(backupScheduler.snapshotBeforeDestructive).toHaveBeenCalledTimes(1) // the redo takes no second backup

    await useUndoStore.getState().undo()
    expect((await db.todoPeople.where('personId').equals(1).toArray()).map((j) => j.todoId).sort()).toEqual([2, 3])
  })

  it('a failed write changes nothing and says so, with no undo step', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(db.tags, 'bulkDelete').mockRejectedValue(new Error('disk'))
    expect(await removePeopleAndTags([1], [10])).toBe(false)

    expect(await db.people.count()).toBe(2)
    expect(await db.tags.count()).toBe(2)
    expect(await db.todoPeople.count()).toBe(2)
    expect(await db.todoTags.count()).toBe(2)
    expect(usePersonStore.getState().people).toHaveLength(2)
    expect(useTagStore.getState().tags).toHaveLength(2)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Couldn’t remove 1 person and 1 tag. Nothing was changed.', notice: true })
  })

  it('goes through the backup gate: a refused backup asks, and Cancel changes nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(backupScheduler.snapshotBeforeDestructive).mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    const run = removePeopleAndTags([1], [])
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    expect(useUIStore.getState().confirmPrompts[0]?.message).toContain('before removing 1 person')
    useUIStore.getState().answerConfirmation(false)
    expect(await run).toBe(false)
    expect(await db.people.count()).toBe(2)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('continuing without a backup says so in the undo step', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(backupScheduler.snapshotBeforeDestructive).mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    const run = removePeopleAndTags([], [10, 11])
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    useUIStore.getState().answerConfirmation(true)
    expect(await run).toBe(true)
    expect(await db.tags.count()).toBe(0)
    expect(useUndoStore.getState().undoStack[0]?.description).toBe('Remove 2 tags — no backup was taken')
  })

  it('ids already gone are skipped, and nothing at all is no step', async () => {
    expect(await removePeopleAndTags([99], [])).toBe(false)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(await removePeopleAndTags([1, 99], [])).toBe(true)
    expect(useUndoStore.getState().undoStack[0]?.description).toBe('Remove 1 person')
  })
})
