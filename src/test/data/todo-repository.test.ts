import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { makeTodo } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

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
    expect(result[0]!.title).toBe('In canvas 1')
  })

  it('getByProject filters by projectId', async () => {
    await todoRepository.insert(makeTodo({ title: 'In project 1', projectId: 1 }))
    await todoRepository.insert(makeTodo({ title: 'In project 2', projectId: 2 }))

    const result = await todoRepository.getByProject(1)
    expect(result).toHaveLength(1)
    expect(result[0]!.title).toBe('In project 1')
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

  it('delete cascades todoTags so no orphan join rows remain', async () => {
    // P1 of code-review-2026-04-25: pre-fix, deleting a todo left its
    // todoTags rows behind because db.todoTags wasn't in the rw transaction.
    const tagId = await db.tags.add({ name: 'urgent', color: '#ff0000' })
    const id = await todoRepository.insert(makeTodo())
    await db.todoTags.add({ todoId: id, tagId })
    expect(await db.todoTags.where('todoId').equals(id).count()).toBe(1)

    await todoRepository.delete(id)

    expect(await db.todoTags.where('todoId').equals(id).count()).toBe(0)
    // The tag itself is unaffected — only the join row goes.
    expect(await db.tags.count()).toBe(1)
  })

  it('bulkDelete cascades todoTags for every removed todo', async () => {
    const tagId = await db.tags.add({ name: 'urgent', color: '#ff0000' })
    const id1 = await todoRepository.insert(makeTodo({ title: 'a' }))
    const id2 = await todoRepository.insert(makeTodo({ title: 'b' }))
    await db.todoTags.bulkAdd([
      { todoId: id1, tagId },
      { todoId: id2, tagId },
    ])

    await todoRepository.bulkDelete([id1, id2])

    expect(await db.todoTags.count()).toBe(0)
    expect(await db.tags.count()).toBe(1)
  })

  it('reorder updates sortOrder', async () => {
    const id = await todoRepository.insert(makeTodo({ sortOrder: 1 }))
    await todoRepository.reorder(id, 5)

    const todo = await todoRepository.getById(id)
    expect(todo!.sortOrder).toBe(5)
  })
})
