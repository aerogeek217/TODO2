import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

function makeTodo(overrides: Partial<import('../../models').TodoItem> = {}) {
  const now = new Date()
  return {
    title: 'Test todo',
    isCompleted: false,
    createdAt: now,
    modifiedAt: now,
    sortOrder: 0,
    ...overrides,
  }
}

describe('todoRepository', () => {
  it('inserts and retrieves a todo', async () => {
    const id = await todoRepository.insert(makeTodo({ title: 'Buy milk' }))
    const todo = await todoRepository.getById(id)
    expect(todo).toBeDefined()
    expect(todo!.title).toBe('Buy milk')
    expect(todo!.id).toBe(id)
  })

  it('getAll returns todos sorted by sortOrder', async () => {
    await todoRepository.insert(makeTodo({ title: 'B', sortOrder: 2 }))
    await todoRepository.insert(makeTodo({ title: 'A', sortOrder: 1 }))
    await todoRepository.insert(makeTodo({ title: 'C', sortOrder: 3 }))

    const all = await todoRepository.getAll()
    expect(all.map((t) => t.title)).toEqual(['A', 'B', 'C'])
  })

  it('getByCanvas filters by canvasId', async () => {
    await todoRepository.insert(makeTodo({ title: 'In canvas 1', canvasId: 1 }))
    await todoRepository.insert(makeTodo({ title: 'In canvas 2', canvasId: 2 }))

    const result = await todoRepository.getByCanvas(1)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('In canvas 1')
  })

  it('getByProject filters by projectId', async () => {
    await todoRepository.insert(makeTodo({ title: 'In project 1', projectId: 1 }))
    await todoRepository.insert(makeTodo({ title: 'In project 2', projectId: 2 }))

    const result = await todoRepository.getByProject(1)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('In project 1')
  })

  it('complete toggles isCompleted', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.complete(id, true)

    const todo = await todoRepository.getById(id)
    expect(todo!.isCompleted).toBe(true)
  })

  it('update modifies all fields', async () => {
    const id = await todoRepository.insert(makeTodo({ title: 'Original' }))
    const todo = await todoRepository.getById(id)
    todo!.title = 'Updated'
    todo!.notes = 'note body'
    await todoRepository.update(todo!)

    const updated = await todoRepository.getById(id)
    expect(updated!.title).toBe('Updated')
    expect(updated!.notes).toBe('note body')
  })

  it('delete removes a todo', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.delete(id)

    const todo = await todoRepository.getById(id)
    expect(todo).toBeUndefined()
  })

  it('reorder updates sortOrder', async () => {
    const id = await todoRepository.insert(makeTodo({ sortOrder: 1 }))
    await todoRepository.reorder(id, 5)

    const todo = await todoRepository.getById(id)
    expect(todo!.sortOrder).toBe(5)
  })
})
