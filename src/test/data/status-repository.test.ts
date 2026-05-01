import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { statusRepository } from '../../data/status-repository'

const now = new Date()

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('statusRepository', () => {
  it('insert and getById round-trip', async () => {
    const id = await statusRepository.insert({ name: 'Open', color: '#00ff00', sortOrder: 0 })
    const status = await statusRepository.getById(id)
    expect(status?.name).toBe('Open')
  })

  it('delete clears statusId on affected todos and removes the row', async () => {
    const statusId = await statusRepository.insert({ name: 'Open', color: '#00ff00', sortOrder: 0 })
    const todoId = (await db.todos.add({
      title: 'Task', isCompleted: false,
      sortOrder: 0, createdAt: now, modifiedAt: now,
      statusId,
    } as never)) as number

    await statusRepository.delete(statusId)
    expect(await statusRepository.getById(statusId)).toBeUndefined()
    const todo = await db.todos.get(todoId)
    expect(todo?.statusId).toBeUndefined()
  })

  it('getTodoIdsForStatus returns the primary keys of todos pointing at the status', async () => {
    const statusId = await statusRepository.insert({ name: 'Open', color: '#00ff00', sortOrder: 0 })
    const t1 = (await db.todos.add({
      title: 'A', isCompleted: false,
      sortOrder: 0, createdAt: now, modifiedAt: now, statusId,
    } as never)) as number
    const t2 = (await db.todos.add({
      title: 'B', isCompleted: false,
      sortOrder: 1, createdAt: now, modifiedAt: now, statusId,
    } as never)) as number
    await db.todos.add({
      title: 'C', isCompleted: false,
      sortOrder: 2, createdAt: now, modifiedAt: now,
    } as never)

    const ids = await statusRepository.getTodoIdsForStatus(statusId)
    expect(ids.sort()).toEqual([t1, t2].sort())
  })

  it('restoreWithTodos re-inserts the row preserving id and re-points affected todos', async () => {
    const statusId = await statusRepository.insert({ name: 'Open', color: '#00ff00', sortOrder: 0 })
    const status = (await statusRepository.getById(statusId))!
    const todoId = (await db.todos.add({
      title: 'Task', isCompleted: false,
      sortOrder: 0, createdAt: now, modifiedAt: now, statusId,
    } as never)) as number

    // Simulate delete: cascade clears statusId on the todo and removes the row.
    await statusRepository.delete(statusId)
    expect((await db.todos.get(todoId))?.statusId).toBeUndefined()

    // Restore: same id back, todo statusId re-pointed.
    await statusRepository.restoreWithTodos(status, [todoId])
    expect(await statusRepository.getById(statusId)).toMatchObject({ id: statusId, name: 'Open' })
    expect((await db.todos.get(todoId))?.statusId).toBe(statusId)
  })

  it('reorder rewrites sortOrder to match the given id sequence', async () => {
    const a = await statusRepository.insert({ name: 'A', color: '#fff', sortOrder: 10 })
    const b = await statusRepository.insert({ name: 'B', color: '#fff', sortOrder: 20 })
    const c = await statusRepository.insert({ name: 'C', color: '#fff', sortOrder: 30 })

    await statusRepository.reorder([c, a, b])

    const rows = await db.statuses.orderBy('sortOrder').toArray()
    expect(rows.map(r => r.name)).toEqual(['C', 'A', 'B'])
    expect(rows.map(r => r.sortOrder)).toEqual([0, 1, 2])
  })
})
