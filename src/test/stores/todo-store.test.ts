import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { todoRepository } from '../../data/todo-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState({ todos: [], loading: false })
  useUndoStore.getState().clear()
})

describe('todoStore', () => {
  it('add creates a todo and updates the store', async () => {
    await useTodoStore.getState().add('Buy milk', 1)
    const { todos } = useTodoStore.getState()
    expect(todos).toHaveLength(1)
    expect(todos[0].title).toBe('Buy milk')
    expect(todos[0].canvasId).toBe(1)
    expect(todos[0].isCompleted).toBe(false)
  })

  it('toggleComplete flips isCompleted', async () => {
    const id = await useTodoStore.getState().add('Task')
    await useTodoStore.getState().toggleComplete(id)
    expect(useTodoStore.getState().todos[0].isCompleted).toBe(true)

    await useTodoStore.getState().toggleComplete(id)
    expect(useTodoStore.getState().todos[0].isCompleted).toBe(false)
  })

  it('remove deletes a todo from store and DB', async () => {
    const id = await useTodoStore.getState().add('Task')
    await useTodoStore.getState().remove(id)
    expect(useTodoStore.getState().todos).toHaveLength(0)

    const fromDb = await db.todos.get(id)
    expect(fromDb).toBeUndefined()
  })

  it('loadByCanvas loads only todos for that canvas', async () => {
    await useTodoStore.getState().add('In 1', 1)
    await useTodoStore.getState().add('In 2', 2)

    await useTodoStore.getState().loadByCanvas(1)
    const { todos } = useTodoStore.getState()
    expect(todos).toHaveLength(1)
    expect(todos[0].title).toBe('In 1')
  })

  it('reorder updates sortOrder', async () => {
    const id = await useTodoStore.getState().add('Task')
    await useTodoStore.getState().reorder(id, 99)
    expect(useTodoStore.getState().todos[0].sortOrder).toBe(99)
  })

  it('addAt inserts with specific projectId and sortOrder', async () => {
    const canvasId = (await db.canvases.add({ name: 'C', sortOrder: 1, createdAt: new Date() })) as number
    const projectId = (await db.projects.add({ name: 'P', canvasId, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() })) as number

    const id = await useTodoStore.getState().addAt('Task', projectId, canvasId, 42)
    const todo = useTodoStore.getState().todos.find(t => t.id === id)
    expect(todo).toBeDefined()
    expect(todo!.projectId).toBe(projectId)
    expect(todo!.sortOrder).toBe(42)
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

  it('bulkSetProject moves multiple todos to a project and clears it', async () => {
    const id1 = await useTodoStore.getState().add('Task 1')
    const id2 = await useTodoStore.getState().add('Task 2')

    await useTodoStore.getState().bulkSetProject([id1, id2], 42)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)!.projectId).toBe(42)
    expect(useTodoStore.getState().todos.find(t => t.id === id2)!.projectId).toBe(42)

    await useTodoStore.getState().bulkSetProject([id1], undefined)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)!.projectId).toBeUndefined()
    expect(useTodoStore.getState().todos.find(t => t.id === id2)!.projectId).toBe(42)
  })

  it('bulkRemove removes multiple todos from store and DB', async () => {
    const id1 = await useTodoStore.getState().add('Task 1')
    const id2 = await useTodoStore.getState().add('Task 2')
    const id3 = await useTodoStore.getState().add('Task 3')

    await useTodoStore.getState().bulkRemove([id1, id3])
    expect(useTodoStore.getState().todos).toHaveLength(1)
    expect(useTodoStore.getState().todos[0].id).toBe(id2)

    expect(await db.todos.get(id1)).toBeUndefined()
    expect(await db.todos.get(id3)).toBeUndefined()
  })

  it('applyMutations applies projectId/sortOrder changes', async () => {
    const canvasId = (await db.canvases.add({ name: 'C', sortOrder: 1, createdAt: new Date() })) as number
    const proj1 = (await db.projects.add({ name: 'P1', canvasId, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() })) as number
    const proj2 = (await db.projects.add({ name: 'P2', canvasId, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 2, createdAt: new Date() })) as number

    const id = await useTodoStore.getState().add('Task', canvasId, proj1)
    await useTodoStore.getState().applyMutations([
      { todoId: id, changes: { projectId: proj2, sortOrder: 10 } },
    ])

    const todo = useTodoStore.getState().todos.find(t => t.id === id)
    expect(todo!.projectId).toBe(proj2)
    expect(todo!.sortOrder).toBe(10)
  })

  it('applyMutations no-ops on empty array', async () => {
    await useTodoStore.getState().add('Task')
    const before = useTodoStore.getState().todos[0]
    await useTodoStore.getState().applyMutations([])
    const after = useTodoStore.getState().todos[0]
    expect(after.sortOrder).toBe(before.sortOrder)
  })

  it('purgeExpiredCompleted removes old completed todos', async () => {
    const id1 = await useTodoStore.getState().add('Old done')
    const id2 = await useTodoStore.getState().add('Recent done')
    const id3 = await useTodoStore.getState().add('Not done')

    // Complete both
    await useTodoStore.getState().toggleComplete(id1)
    await useTodoStore.getState().toggleComplete(id2)

    // Backdate id1's modifiedAt
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 40)
    await db.todos.update(id1, { modifiedAt: oldDate })
    useTodoStore.setState({
      todos: useTodoStore.getState().todos.map(t =>
        t.id === id1 ? { ...t, modifiedAt: oldDate } : t
      ),
    })

    const count = await useTodoStore.getState().purgeExpiredCompleted(30)
    expect(count).toBe(1)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)).toBeUndefined()
    expect(useTodoStore.getState().todos.find(t => t.id === id2)).toBeDefined()
    expect(useTodoStore.getState().todos.find(t => t.id === id3)).toBeDefined()
  })

  it('purgeExpiredCompleted returns 0 when nothing to purge', async () => {
    await useTodoStore.getState().add('Active task')
    const count = await useTodoStore.getState().purgeExpiredCompleted(30)
    expect(count).toBe(0)
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

    it('addAt applies defaultStatusId from settings when set', async () => {
      useSettingsStore.setState({ defaultStatusId: 5 })
      const canvasId = (await db.canvases.add({ name: 'C', sortOrder: 1, createdAt: new Date() })) as number
      const projectId = (await db.projects.add({ name: 'P', canvasId, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() })) as number

      const id = await useTodoStore.getState().addAt('Child', projectId, canvasId, 100)
      const todo = useTodoStore.getState().todos.find(t => t.id === id)
      expect(todo!.statusId).toBe(5)
    })

    it('addAt does not set statusId when defaultStatusId is null', async () => {
      useSettingsStore.setState({ defaultStatusId: null })
      const canvasId = (await db.canvases.add({ name: 'C', sortOrder: 1, createdAt: new Date() })) as number
      const projectId = (await db.projects.add({ name: 'P', canvasId, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() })) as number

      const id = await useTodoStore.getState().addAt('Child', projectId, canvasId, 100)
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

  describe('tag helpers', () => {
    it('addTag normalizes and persists a single slug', async () => {
      const id = await useTodoStore.getState().add('Task')
      await useTodoStore.getState().addTag(id, '  URGENT  ')

      const inMemory = useTodoStore.getState().todos.find((t) => t.id === id)
      expect(inMemory!.tags).toEqual(['urgent'])

      const fromDb = await db.todos.get(id)
      expect(fromDb!.tags).toEqual(['urgent'])
    })

    it('addTag is idempotent — re-adding an existing slug no-ops', async () => {
      const id = await useTodoStore.getState().add('Task')
      await useTodoStore.getState().addTag(id, 'alpha')
      const afterFirst = useTodoStore.getState().todos.find((t) => t.id === id)!.modifiedAt
      // Tick the clock so a re-add would leave a visible timestamp bump if it wrote.
      await new Promise((r) => setTimeout(r, 2))
      await useTodoStore.getState().addTag(id, 'ALPHA')

      const todo = useTodoStore.getState().todos.find((t) => t.id === id)!
      expect(todo.tags).toEqual(['alpha'])
      expect(todo.modifiedAt).toEqual(afterFirst)
    })

    it('addTag rejects invalid slugs silently (no DB write, no crash)', async () => {
      const id = await useTodoStore.getState().add('Task')
      await useTodoStore.getState().addTag(id, 'has space')
      await useTodoStore.getState().addTag(id, 'bang!')
      await useTodoStore.getState().addTag(id, '')

      const fromDb = await db.todos.get(id)
      expect(fromDb!.tags).toBeUndefined()
    })

    it('addTag appends in insertion order', async () => {
      const id = await useTodoStore.getState().add('Task')
      await useTodoStore.getState().addTag(id, 'gamma')
      await useTodoStore.getState().addTag(id, 'alpha')
      await useTodoStore.getState().addTag(id, 'beta')

      expect(useTodoStore.getState().todos.find((t) => t.id === id)!.tags)
        .toEqual(['gamma', 'alpha', 'beta'])
    })

    it('removeTag removes and no-ops when absent', async () => {
      const id = await useTodoStore.getState().add('Task')
      await useTodoStore.getState().setTags(id, ['alpha', 'beta'])
      await useTodoStore.getState().removeTag(id, 'ALPHA')

      const todo = useTodoStore.getState().todos.find((t) => t.id === id)!
      expect(todo.tags).toEqual(['beta'])

      await useTodoStore.getState().removeTag(id, 'never-was-there')
      expect(useTodoStore.getState().todos.find((t) => t.id === id)!.tags)
        .toEqual(['beta'])
    })

    it('removeTag dropping the last tag clears the field in DB + memory', async () => {
      const id = await useTodoStore.getState().add('Task')
      await useTodoStore.getState().addTag(id, 'solo')
      await useTodoStore.getState().removeTag(id, 'solo')

      const inMemory = useTodoStore.getState().todos.find((t) => t.id === id)!
      expect(inMemory.tags).toBeUndefined()

      const fromDb = await db.todos.get(id)
      expect(fromDb!.tags).toBeUndefined()
      expect('tags' in (fromDb as object)).toBe(false)
    })

    it('setTags replaces, normalizes, and dedupes first-seen', async () => {
      const id = await useTodoStore.getState().add('Task')
      await useTodoStore.getState().setTags(id, ['Alpha', 'alpha', '', 'BAD CHAR!', 'beta'])

      expect(useTodoStore.getState().todos.find((t) => t.id === id)!.tags)
        .toEqual(['alpha', 'beta'])
    })

    it('setTags with empty array drops the field', async () => {
      const id = await useTodoStore.getState().add('Task')
      await useTodoStore.getState().addTag(id, 'a')
      await useTodoStore.getState().setTags(id, [])

      const fromDb = await db.todos.get(id)
      expect(fromDb!.tags).toBeUndefined()
      expect('tags' in (fromDb as object)).toBe(false)
    })

    it('setTags with the same set is a no-op (does not bump modifiedAt)', async () => {
      const id = await useTodoStore.getState().add('Task')
      await useTodoStore.getState().setTags(id, ['alpha', 'beta'])
      const before = useTodoStore.getState().todos.find((t) => t.id === id)!.modifiedAt
      await new Promise((r) => setTimeout(r, 2))
      await useTodoStore.getState().setTags(id, ['Alpha', 'BETA'])

      expect(useTodoStore.getState().todos.find((t) => t.id === id)!.modifiedAt)
        .toEqual(before)
    })

    it('renameTag rewrites src→dst across all matching rows, returns count', async () => {
      const a = await useTodoStore.getState().add('A')
      const b = await useTodoStore.getState().add('B')
      const c = await useTodoStore.getState().add('C')
      await useTodoStore.getState().setTags(a, ['old', 'other'])
      await useTodoStore.getState().setTags(b, ['old'])
      await useTodoStore.getState().setTags(c, ['unrelated'])

      const touched = await useTodoStore.getState().renameTag('old', 'new')
      expect(touched).toBe(2)

      expect(useTodoStore.getState().todos.find((t) => t.id === a)!.tags)
        .toEqual(['new', 'other'])
      expect(useTodoStore.getState().todos.find((t) => t.id === b)!.tags)
        .toEqual(['new'])
      expect(useTodoStore.getState().todos.find((t) => t.id === c)!.tags)
        .toEqual(['unrelated'])

      // DB mirrors memory.
      expect((await db.todos.get(a))!.tags).toEqual(['new', 'other'])
      expect((await db.todos.get(b))!.tags).toEqual(['new'])
      expect((await db.todos.get(c))!.tags).toEqual(['unrelated'])
    })

    it('renameTag dedupes when dst already present in same row', async () => {
      const id = await useTodoStore.getState().add('T')
      await useTodoStore.getState().setTags(id, ['beta', 'alpha'])

      const touched = await useTodoStore.getState().renameTag('alpha', 'beta')
      expect(touched).toBe(1)
      expect(useTodoStore.getState().todos.find((t) => t.id === id)!.tags)
        .toEqual(['beta'])
    })

    it('renameTag with src === dst returns 0 and does not walk', async () => {
      const id = await useTodoStore.getState().add('T')
      await useTodoStore.getState().setTags(id, ['alpha'])
      const before = useTodoStore.getState().todos.find((t) => t.id === id)!.modifiedAt

      const touched = await useTodoStore.getState().renameTag('ALPHA', 'alpha')
      expect(touched).toBe(0)
      expect(useTodoStore.getState().todos.find((t) => t.id === id)!.modifiedAt)
        .toEqual(before)
    })

    it('renameTag with invalid src or dst returns 0 without writing', async () => {
      const id = await useTodoStore.getState().add('T')
      await useTodoStore.getState().setTags(id, ['alpha'])

      expect(await useTodoStore.getState().renameTag('alpha', 'bad char!')).toBe(0)
      expect(await useTodoStore.getState().renameTag('has space', 'beta')).toBe(0)

      expect(useTodoStore.getState().todos.find((t) => t.id === id)!.tags)
        .toEqual(['alpha'])
    })
  })
})
