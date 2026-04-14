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

  it('toggleStar flips isStarred', async () => {
    const id = await useTodoStore.getState().add('Task')
    await useTodoStore.getState().toggleStar(id)
    expect(useTodoStore.getState().todos[0].isStarred).toBe(true)
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

  it('addAt inserts with specific projectId, parentId, sortOrder', async () => {
    const canvasId = (await db.canvases.add({ name: 'C', sortOrder: 1, createdAt: new Date() })) as number
    const projectId = (await db.projects.add({ name: 'P', canvasId, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() })) as number
    const parentId = await useTodoStore.getState().add('Parent', canvasId, projectId)

    const childId = await useTodoStore.getState().addAt('Child', projectId, canvasId, parentId, 42)
    const child = useTodoStore.getState().todos.find(t => t.id === childId)
    expect(child).toBeDefined()
    expect(child!.projectId).toBe(projectId)
    expect(child!.parentId).toBe(parentId)
    expect(child!.sortOrder).toBe(42)
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

  it('bulkSetStarred stars/unstars multiple todos', async () => {
    const id1 = await useTodoStore.getState().add('Task 1')
    const id2 = await useTodoStore.getState().add('Task 2')

    await useTodoStore.getState().bulkSetStarred([id1, id2], true)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)!.isStarred).toBe(true)
    expect(useTodoStore.getState().todos.find(t => t.id === id2)!.isStarred).toBe(true)

    await useTodoStore.getState().bulkSetStarred([id1], false)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)!.isStarred).toBe(false)
    expect(useTodoStore.getState().todos.find(t => t.id === id2)!.isStarred).toBe(true)
  })

  it('bulkSetPriority sets priority on multiple todos', async () => {
    const { Priority } = await import('../../models')
    const id1 = await useTodoStore.getState().add('Task 1')
    const id2 = await useTodoStore.getState().add('Task 2')

    await useTodoStore.getState().bulkSetPriority([id1, id2], Priority.High)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)!.priority).toBe(Priority.High)
    expect(useTodoStore.getState().todos.find(t => t.id === id2)!.priority).toBe(Priority.High)
  })

  it('bulkSetDueDate sets date and clears date', async () => {
    const id1 = await useTodoStore.getState().add('Task 1')
    const id2 = await useTodoStore.getState().add('Task 2')
    const date = new Date('2026-06-15')

    await useTodoStore.getState().bulkSetDueDate([id1, id2], date)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)!.dueDate).toEqual(date)
    expect(useTodoStore.getState().todos.find(t => t.id === id2)!.dueDate).toEqual(date)

    await useTodoStore.getState().bulkSetDueDate([id1], undefined)
    expect(useTodoStore.getState().todos.find(t => t.id === id1)!.dueDate).toBeUndefined()
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

  it('applyMutations applies projectId/parentId/sortOrder changes', async () => {
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

  describe('toggleAssigned undo/redo', () => {
    it('toggleAssigned undo restores original state', async () => {
      const id = await useTodoStore.getState().add('Task')
      useUndoStore.getState().clear()

      // Task starts unassigned
      expect(useTodoStore.getState().todos.find(t => t.id === id)!.isAssigned).toBeFalsy()

      await useTodoStore.getState().toggleAssigned(id)
      expect(useTodoStore.getState().todos.find(t => t.id === id)!.isAssigned).toBe(true)

      await useUndoStore.getState().undo()
      expect(useTodoStore.getState().todos.find(t => t.id === id)!.isAssigned).toBeFalsy()
    })

    it('toggleAssigned redo re-applies the toggle', async () => {
      const id = await useTodoStore.getState().add('Task')
      useUndoStore.getState().clear()

      await useTodoStore.getState().toggleAssigned(id)
      expect(useTodoStore.getState().todos.find(t => t.id === id)!.isAssigned).toBe(true)

      await useUndoStore.getState().undo()
      expect(useTodoStore.getState().todos.find(t => t.id === id)!.isAssigned).toBeFalsy()

      await useUndoStore.getState().redo()
      expect(useTodoStore.getState().todos.find(t => t.id === id)!.isAssigned).toBe(true)
    })
  })

  describe('bulkSetAssigned undo', () => {
    it('undo restores per-item original assigned state', async () => {
      const id1 = await useTodoStore.getState().add('Task 1')
      const id2 = await useTodoStore.getState().add('Task 2')
      const id3 = await useTodoStore.getState().add('Task 3')

      // Set mixed initial states: id1=assigned, id2=unassigned, id3=assigned
      await useTodoStore.getState().toggleAssigned(id1)
      await useTodoStore.getState().toggleAssigned(id3)
      useUndoStore.getState().clear()

      expect(useTodoStore.getState().todos.find(t => t.id === id1)!.isAssigned).toBe(true)
      expect(useTodoStore.getState().todos.find(t => t.id === id2)!.isAssigned).toBeFalsy()
      expect(useTodoStore.getState().todos.find(t => t.id === id3)!.isAssigned).toBe(true)

      // Bulk set all to true
      await useTodoStore.getState().bulkSetAssigned([id1, id2, id3], true)
      expect(useTodoStore.getState().todos.find(t => t.id === id2)!.isAssigned).toBe(true)

      // Undo should restore per-item: id1=true, id2=false, id3=true
      await useUndoStore.getState().undo()
      expect(useTodoStore.getState().todos.find(t => t.id === id1)!.isAssigned).toBe(true)
      expect(useTodoStore.getState().todos.find(t => t.id === id2)!.isAssigned).toBeFalsy()
      expect(useTodoStore.getState().todos.find(t => t.id === id3)!.isAssigned).toBe(true)
    })
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

      const id = await useTodoStore.getState().addAt('Child', projectId, canvasId, undefined, 100)
      const todo = useTodoStore.getState().todos.find(t => t.id === id)
      expect(todo!.statusId).toBe(5)
    })

    it('addAt does not set statusId when defaultStatusId is null', async () => {
      useSettingsStore.setState({ defaultStatusId: null })
      const canvasId = (await db.canvases.add({ name: 'C', sortOrder: 1, createdAt: new Date() })) as number
      const projectId = (await db.projects.add({ name: 'P', canvasId, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() })) as number

      const id = await useTodoStore.getState().addAt('Child', projectId, canvasId, undefined, 100)
      const todo = useTodoStore.getState().todos.find(t => t.id === id)
      expect(todo!.statusId).toBeUndefined()
    })
  })

  describe('optimistic rollback', () => {
    it('toggleStar_dbRejects_revertsIsStarredToFalse', async () => {
      // Arrange
      const id = await useTodoStore.getState().add('Task')
      const spy = vi.spyOn(todoRepository, 'toggleStar').mockRejectedValueOnce(new Error('DB error'))

      // Act
      await expect(useTodoStore.getState().toggleStar(id)).rejects.toThrow('DB error')

      // Assert
      const todo = useTodoStore.getState().todos.find((t) => t.id === id)
      expect(todo!.isStarred).toBe(false)
      expect(useTodoStore.getState().error).toBeTruthy()

      spy.mockRestore()
    })

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

    it('toggleStar_dbRejects_doesNotPushToUndoStack', async () => {
      // Arrange
      const id = await useTodoStore.getState().add('Task')
      // Clear the undo entry pushed by add() so only toggleStar's result matters
      useUndoStore.getState().clear()
      const spy = vi.spyOn(todoRepository, 'toggleStar').mockRejectedValueOnce(new Error('DB error'))

      // Act
      await expect(useTodoStore.getState().toggleStar(id)).rejects.toThrow()

      // Assert
      expect(useUndoStore.getState().undoStack).toHaveLength(0)

      spy.mockRestore()
    })
  })
})
