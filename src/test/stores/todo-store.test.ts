import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTagStore } from '../../stores/tag-store'
import { usePersonStore } from '../../stores/person-store'
import { todoRepository } from '../../data/todo-repository'
import { tagRepository } from '../../data/tag-repository'
import { personRepository } from '../../data/person-repository'
import { selectExpiredCompleted } from '../../utils/completed-at'
/** What the launch prompt / Settings cleanup delete once the user confirms. */
const purgeExpired = async (days: number) => {
  const outcome = await useTodoStore.getState().purgeCompleted(selectExpiredCompleted(useTodoStore.getState().todos, days).map((t) => t.id))
  return outcome.status === 'done' ? outcome.deleted : -1
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState({ todos: [], todosVersion: 0, loading: false })
  useUndoStore.getState().clear()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useTagStore.setState(useTagStore.getInitialState(), true)
  usePersonStore.setState(usePersonStore.getInitialState(), true)
})

describe('todoStore', () => {
  it('add creates a todo and updates the store', async () => {
    await useTodoStore.getState().add('Buy milk')
    const { todos } = useTodoStore.getState()
    expect(todos).toHaveLength(1)
    expect(todos[0]!.title).toBe('Buy milk')
    expect(todos[0]!.isCompleted).toBe(false)
  })

  it('add places the new todo after the highest sortOrder', async () => {
    const id1 = await useTodoStore.getState().add('First')
    await useTodoStore.getState().reorder(id1, 41)
    const id2 = await useTodoStore.getState().add('Second')
    expect(useTodoStore.getState().todos.find((t) => t.id === id2)!.sortOrder).toBe(42)
  })

  it('toggleComplete flips isCompleted', async () => {
    const id = await useTodoStore.getState().add('Task')
    await useTodoStore.getState().toggleComplete(id)
    expect(useTodoStore.getState().todos[0]!.isCompleted).toBe(true)

    await useTodoStore.getState().toggleComplete(id)
    expect(useTodoStore.getState().todos[0]!.isCompleted).toBe(false)
  })

  it('remove deletes a todo from store and DB', async () => {
    const id = await useTodoStore.getState().add('Task')
    await useTodoStore.getState().remove(id)
    expect(useTodoStore.getState().todos).toHaveLength(0)

    const fromDb = await db.todos.get(id)
    expect(fromDb).toBeUndefined()
  })

  it('loadAll loads every todo from the DB', async () => {
    await useTodoStore.getState().add('One')
    await useTodoStore.getState().add('Two')
    useTodoStore.setState({ todos: [] })

    await useTodoStore.getState().loadAll()
    expect(useTodoStore.getState().todos.map((t) => t.title).sort()).toEqual(['One', 'Two'])
  })

  it('reorder updates sortOrder', async () => {
    const id = await useTodoStore.getState().add('Task')
    await useTodoStore.getState().reorder(id, 99)
    expect(useTodoStore.getState().todos[0]!.sortOrder).toBe(99)
  })

  it('bulkSetCompleted marks multiple todos completed', async () => {
    const id1 = await useTodoStore.getState().add('Task 1')
    const id2 = await useTodoStore.getState().add('Task 2')
    const id3 = await useTodoStore.getState().add('Task 3')

    await useTodoStore.getState().bulkSetCompleted([id1, id2], true)
    const todos = useTodoStore.getState().todos
    expect(todos.find(t => t.id === id1)!.isCompleted).toBe(true)
    expect(todos.find(t => t.id === id2)!.isCompleted).toBe(true)
    expect(todos.find(t => t.id === id3)!.isCompleted).toBe(false)
  })

  it('bulkSetDeadline sets date and clears date', async () => {
    const id1 = await useTodoStore.getState().add('Task 1')
    const id2 = await useTodoStore.getState().add('Task 2')
    const date = new Date('2026-06-15')

    await useTodoStore.getState().bulkSetDeadline([id1, id2], date)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)!.dueDate).toEqual(date)
    expect(useTodoStore.getState().todos.find(t => t.id === id2)!.dueDate).toEqual(date)

    await useTodoStore.getState().bulkSetDeadline([id1], null)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)!.dueDate).toBeUndefined()
  })

  it('bulkRemove removes multiple todos from store and DB', async () => {
    const id1 = await useTodoStore.getState().add('Task 1')
    const id2 = await useTodoStore.getState().add('Task 2')
    const id3 = await useTodoStore.getState().add('Task 3')

    await useTodoStore.getState().bulkRemove([id1, id3])
    expect(useTodoStore.getState().todos).toHaveLength(1)
    expect(useTodoStore.getState().todos[0]!.id).toBe(id2)

    expect(await db.todos.get(id1)).toBeUndefined()
    expect(await db.todos.get(id3)).toBeUndefined()
  })

  it('undo → redo → undo of an add leaves no task behind', async () => {
    const id = await useTodoStore.getState().add('Task')
    const undoStore = useUndoStore.getState()
    await undoStore.undo()
    await undoStore.redo()
    expect(useTodoStore.getState().todos.map((t) => t.id)).toEqual([id])
    expect(await db.todos.count()).toBe(1)
    await undoStore.undo()
    expect(useTodoStore.getState().todos).toHaveLength(0)
    expect(await db.todos.count()).toBe(0)
  })

  it('undo → redo → undo of a duplicate leaves only the original', async () => {
    const id = await useTodoStore.getState().add('Task')
    const tagId = await tagRepository.getOrCreate('ops', '#111111')
    await tagRepository.assignTag(id, tagId)
    const copyId = await useTodoStore.getState().duplicate(id)
    const undoStore = useUndoStore.getState()
    await undoStore.undo()
    await undoStore.redo()
    expect(useTodoStore.getState().todos.map((t) => t.id).sort()).toEqual([id, copyId].sort())
    expect((await db.todoTags.where('todoId').equals(copyId!).toArray()).map((r) => r.tagId)).toEqual([tagId])
    await undoStore.undo()
    expect(useTodoStore.getState().todos.map((t) => t.id)).toEqual([id])
    expect(await db.todos.count()).toBe(1)
  })

  it('undoing a delete brings the task back with its people and tags', async () => {
    const id = await useTodoStore.getState().add('Task')
    const personId = await personRepository.insert({ name: 'Dana', initials: 'DA' })
    const tagId = await tagRepository.getOrCreate('ops', '#111111')
    await personRepository.assignPerson(id, personId)
    await tagRepository.assignTag(id, tagId)

    await useTodoStore.getState().remove(id)
    expect(await db.todoTags.where('todoId').equals(id).count()).toBe(0)
    await useUndoStore.getState().undo()

    expect(useTodoStore.getState().todos.map((t) => t.id)).toEqual([id])
    expect((await db.todoPeople.where('todoId').equals(id).toArray()).map((r) => r.personId)).toEqual([personId])
    expect((await db.todoTags.where('todoId').equals(id).toArray()).map((r) => r.tagId)).toEqual([tagId])
    expect(useTagStore.getState().assignedTagsMap.get(id)?.map((t) => t.id)).toEqual([tagId])
  })

  it('undoing a bulk delete brings every task back with its tags', async () => {
    const id1 = await useTodoStore.getState().add('Task 1')
    const id2 = await useTodoStore.getState().add('Task 2')
    const tagA = await tagRepository.getOrCreate('a', '#111111')
    const tagB = await tagRepository.getOrCreate('b', '#222222')
    await tagRepository.assignTag(id1, tagA)
    await tagRepository.assignTag(id2, tagA)
    await tagRepository.assignTag(id2, tagB)

    await useTodoStore.getState().bulkRemove([id1, id2])
    await useUndoStore.getState().undo()

    const tagsOf = async (id: number) =>
      (await db.todoTags.where('todoId').equals(id).toArray()).map((r) => r.tagId).sort()
    expect(useTodoStore.getState().todos.map((t) => t.id).sort()).toEqual([id1, id2].sort())
    expect(await tagsOf(id1)).toEqual([tagA])
    expect(await tagsOf(id2)).toEqual([tagA, tagB].sort())
  })

  it('todosVersion bumps on id-set changes but not on field edits', async () => {
    // Dashboard/ListView memoize assignment-load effects on
    // `${todos.length}:${todosVersion}`, so the bump contract is load-bearing:
    // add / remove / bulkRemove / restore / purge should tick the counter,
    // update / toggleComplete / reorder / bulk-field setters should not.
    const v0 = useTodoStore.getState().todosVersion
    const id1 = await useTodoStore.getState().add('Task 1')
    const vAfterAdd = useTodoStore.getState().todosVersion
    expect(vAfterAdd).toBeGreaterThan(v0)

    // Field edits (update + toggleComplete + reorder + bulkSet*) keep the
    // version pinned — those don't change the id-set.
    await useTodoStore.getState().toggleComplete(id1)
    await useTodoStore.getState().reorder(id1, 99)
    await useTodoStore.getState().bulkSetStatus([id1], undefined)
    expect(useTodoStore.getState().todosVersion).toBe(vAfterAdd)

    // Second add bumps again.
    const id2 = await useTodoStore.getState().add('Task 2')
    const vAfterSecondAdd = useTodoStore.getState().todosVersion
    expect(vAfterSecondAdd).toBeGreaterThan(vAfterAdd)

    // remove + bulkRemove both bump.
    await useTodoStore.getState().remove(id1)
    const vAfterRemove = useTodoStore.getState().todosVersion
    expect(vAfterRemove).toBeGreaterThan(vAfterSecondAdd)
    await useTodoStore.getState().bulkRemove([id2])
    expect(useTodoStore.getState().todosVersion).toBeGreaterThan(vAfterRemove)
  })

  it('purgeCompleted (expired selection) removes old completed todos', async () => {
    const id1 = await useTodoStore.getState().add('Old done')
    const id2 = await useTodoStore.getState().add('Recent done')
    const id3 = await useTodoStore.getState().add('Not done')

    // Complete both
    await useTodoStore.getState().toggleComplete(id1)
    await useTodoStore.getState().toggleComplete(id2)

    // Backdate id1's completion (the purge clock is completedAt)
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 40)
    await db.todos.update(id1, { completedAt: oldDate })
    useTodoStore.setState({
      todos: useTodoStore.getState().todos.map(t =>
        t.id === id1 ? { ...t, completedAt: oldDate } : t
      ),
    })

    const count = await purgeExpired(30)
    expect(count).toBe(1)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)).toBeUndefined()
    expect(useTodoStore.getState().todos.find(t => t.id === id2)).toBeDefined()
    expect(useTodoStore.getState().todos.find(t => t.id === id3)).toBeDefined()
  })

  it('purgeCompleted (expired selection) returns 0 when nothing to purge', async () => {
    await useTodoStore.getState().add('Active task')
    const count = await purgeExpired(30)
    expect(count).toBe(0)
  })

  it('duplicate copies fields, people and tags onto a new todo', async () => {
    const id = await useTodoStore.getState().add('Original')
    const original = useTodoStore.getState().todos.find((t) => t.id === id)!
    const due = new Date(2026, 5, 15)
    await useTodoStore.getState().update({ ...original, dueDate: due, notes: 'n', statusId: 3 })
    const tagA = await tagRepository.insert({ name: 'Project: Alpha', color: '#123456' })
    const tagB = await tagRepository.insert({ name: 'urgent', color: '#654321' })
    await tagRepository.assignTag(id, tagA)
    await tagRepository.assignTag(id, tagB)
    const personId = (await db.people.add({ name: 'Ann', initials: 'A' })) as number
    await personRepository.assignPerson(id, personId)

    const newId = await useTodoStore.getState().duplicate(id)
    expect(newId).toBeDefined()
    expect(newId).not.toBe(id)
    const copy = useTodoStore.getState().todos.find((t) => t.id === newId)!
    expect(copy).toMatchObject({ title: 'Original', dueDate: due, notes: 'n', statusId: 3, isCompleted: false })

    const tagIds = ((await tagRepository.getAssignedTagsForTodos([newId!])).get(newId!) ?? []).map((t) => t.id).sort()
    expect(tagIds).toEqual([tagA, tagB].sort())
    expect(useTagStore.getState().assignedTagsMap.get(newId!)?.map((t) => t.name).sort()).toEqual(['Project: Alpha', 'urgent'])
    expect((await personRepository.getAssignedPeople(newId!)).map((p) => p.id)).toEqual([personId])
    // The original keeps its own assignments.
    expect(((await tagRepository.getAssignedTagsForTodos([id])).get(id) ?? []).length).toBe(2)
  })

  describe('defaultStatusId', () => {
    it('add applies defaultStatusId from settings when set', async () => {
      useSettingsStore.setState({ defaultStatusId: 7 })
      const id = await useTodoStore.getState().add('Task with status')
      const todo = useTodoStore.getState().todos.find(t => t.id === id)
      expect(todo!.statusId).toBe(7)
    })

    it('add does not set statusId when defaultStatusId is null', async () => {
      useSettingsStore.setState({ defaultStatusId: null })
      const id = await useTodoStore.getState().add('Task without status')
      const todo = useTodoStore.getState().todos.find(t => t.id === id)
      expect(todo!.statusId).toBeUndefined()
    })
  })

  describe('optimistic rollback', () => {
    it('toggleComplete_dbRejects_revertsIsCompletedToFalse', async () => {
      // Arrange
      const id = await useTodoStore.getState().add('Task')
      const spy = vi.spyOn(todoRepository, 'complete').mockRejectedValueOnce(new Error('DB error'))

      // Act
      await expect(useTodoStore.getState().toggleComplete(id)).rejects.toThrow('DB error')

      // Assert
      const todo = useTodoStore.getState().todos.find((t) => t.id === id)
      expect(todo!.isCompleted).toBe(false)

      spy.mockRestore()
    })

    it('update_dbRejects_revertsToOriginalTitle', async () => {
      // Arrange
      const id = await useTodoStore.getState().add('Original title')
      const original = useTodoStore.getState().todos.find((t) => t.id === id)!
      const spy = vi.spyOn(todoRepository, 'update').mockRejectedValueOnce(new Error('DB error'))

      // Act
      await expect(
        useTodoStore.getState().update({ ...original, title: 'Changed title' })
      ).rejects.toThrow('DB error')

      // Assert
      const todo = useTodoStore.getState().todos.find((t) => t.id === id)
      expect(todo!.title).toBe('Original title')

      spy.mockRestore()
    })

  })

})
