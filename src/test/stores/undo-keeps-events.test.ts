// Undoing a delete puts the task's event history back, and redoing a create
// that was undone keeps its `created` event — so the dashboard trend reads
// the same as before the delete / undo.
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { computeTrend } from '../../services/stats/trend'
import { startOfToday } from '../../utils/date'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

const events = () => db.todoEvents.orderBy('id').toArray()

/** The 14-day trend over the store's tasks (task id lists sorted: the store's task order isn't part of it). */
async function trend(): Promise<unknown> {
  const stats = computeTrend(useTodoStore.getState().todos, await events(), { today: startOfToday(), weekStartsOn: 1 }, '14d')
  return JSON.parse(JSON.stringify(stats, (key, value: unknown) =>
    key.endsWith('Ids') && Array.isArray(value) ? [...(value as number[])].sort((x, y) => x - y) : value))
}

/** A task with a history: created, a due date, completed and reopened. */
async function taskWithHistory(title: string): Promise<number> {
  const id = await useTodoStore.getState().add(title)
  await useTodoStore.getState().update(id, { dueDate: new Date(2026, 9, 20) })
  await useTodoStore.getState().toggleComplete(id)
  await useTodoStore.getState().toggleComplete(id)
  return id
}

describe('delete undo keeps the task events', () => {
  it('one task: undo puts back every event row as it was', async () => {
    const id = await taskWithHistory('Milk')
    await taskWithHistory('Bread')
    const before = await events()
    const trendBefore = await trend()
    expect(before.filter((e) => e.todoId === id).map((e) => e.type)).toEqual(['created', 'deadline', 'completed', 'reopened'])

    await useTodoStore.getState().remove(id)
    expect((await events()).some((e) => e.todoId === id)).toBe(false)
    await useUndoStore.getState().undo()

    expect(await events()).toEqual(before)
    expect(await trend()).toEqual(trendBefore)

    // Redo deletes them again; a second undo brings them back again.
    await useUndoStore.getState().redo()
    await useUndoStore.getState().undo()
    expect(await events()).toEqual(before)
  })

  it('several tasks: undo of a bulk delete puts back every event row', async () => {
    const a = await taskWithHistory('A')
    const b = await taskWithHistory('B')
    await taskWithHistory('C')
    const before = await events()
    const trendBefore = await trend()

    await useTodoStore.getState().bulkRemove([a, b])
    await useUndoStore.getState().undo()

    expect(await events()).toEqual(before)
    expect(await trend()).toEqual(trendBefore)
  })
})

describe('redo of a create keeps its created event', () => {
  it('add', async () => {
    const id = await useTodoStore.getState().add('Milk')
    const before = await events()
    await useUndoStore.getState().undo()
    expect(await db.todos.get(id)).toBeUndefined()
    await useUndoStore.getState().redo()
    expect(await events()).toEqual(before)
    expect(before.map((e) => e.type)).toEqual(['created'])
  })

  it('add of several', async () => {
    const now = new Date()
    const todo = (title: string) => ({ title, isCompleted: false, createdAt: now, modifiedAt: now })
    await useTodoStore.getState().addMany(
      [{ todo: todo('A'), personIds: [], tagIds: [] }, { todo: todo('B'), personIds: [], tagIds: [] }],
      { description: 'Add 2 tasks' },
    )
    const before = await events()
    await useUndoStore.getState().undo()
    expect(await events()).toEqual([])
    await useUndoStore.getState().redo()
    expect(await events()).toEqual(before)
  })

  it('duplicate', async () => {
    const id = await useTodoStore.getState().add('Milk')
    const copy = await useTodoStore.getState().duplicate(id)
    const before = await events()
    await useUndoStore.getState().undo()
    expect((await events()).some((e) => e.todoId === copy)).toBe(false)
    await useUndoStore.getState().redo()
    expect(await events()).toEqual(before)
  })
})
