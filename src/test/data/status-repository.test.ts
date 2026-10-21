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

  it('delete is a status edit on each task it clears: returns them, one modifiedAt, a status event each; restore the same way back', async () => {
    const statusId = await statusRepository.insert({ name: 'Open', color: '#00ff00', sortOrder: 0 })
    const status = (await statusRepository.getById(statusId))!
    const t1 = (await db.todos.add({
      title: 'A', isCompleted: false,
      sortOrder: 0, createdAt: now, modifiedAt: now, statusId,
    } as never)) as number
    const t2 = (await db.todos.add({
      title: 'B', isCompleted: false,
      sortOrder: 1, createdAt: now, modifiedAt: now, statusId,
    } as never)) as number
    const other = (await db.todos.add({
      title: 'C', isCompleted: false,
      sortOrder: 2, createdAt: now, modifiedAt: now,
    } as never)) as number

    const at = new Date(now.getTime() + 60_000)
    const ids = await statusRepository.delete(statusId, at)
    expect([...ids].sort()).toEqual([t1, t2].sort())
    for (const id of [t1, t2]) expect((await db.todos.get(id))!.modifiedAt).toEqual(at)
    expect((await db.todos.get(other))!.modifiedAt).toEqual(now)
    const cleared = await db.todoEvents.where('type').equals('status').toArray()
    expect(cleared.map((e) => [e.todoId, e.fromValue, e.toValue, e.timestamp]).sort())
      .toEqual([[t1, statusId, null, at.toISOString()], [t2, statusId, null, at.toISOString()]].sort())

    const back = new Date(now.getTime() + 120_000)
    await statusRepository.restoreWithTodos(status, ids, back)
    for (const id of [t1, t2]) {
      expect((await db.todos.get(id))).toMatchObject({ statusId, modifiedAt: back })
    }
    expect(await db.todoEvents.where('type').equals('status').count()).toBe(4)
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
