// A recurrence rule left without a due date to advance from is dropped by
// the write (the repository's rule, `withOrphanedRuleDropped`); the store's
// copy drops it the same way, and Undo puts it back in both.
import { describe, it, expect, beforeEach } from 'vitest'
import { todoRepository } from '../../data/todo-repository'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

const WEEKLY = { type: 'weekly' as const }

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

const mem = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)!
const stored = async (id: number) => (await todoRepository.getById(id))!

/** A task with a weekly rule and no due date (as an older file can hold). */
async function orphanTask(): Promise<number> {
  const id = await useTodoStore.getState().add('Water plants')
  await useTodoStore.getState().update(id, { recurrenceRule: WEEKLY })
  expect((await stored(id)).recurrenceRule).toEqual(WEEKLY)
  useUndoStore.getState().clear()
  return id
}

describe('a rule without a due date', () => {
  it('bulk complete drops it in the store as in the database; Undo brings it back', async () => {
    const id = await orphanTask()
    await useTodoStore.getState().bulkSetCompleted([id], true)
    for (const row of [mem(id), await stored(id)]) {
      expect(row.isCompleted).toBe(true)
      expect(row.recurrenceRule).toBeUndefined()
    }

    await useUndoStore.getState().undo()
    expect(mem(id)).toMatchObject({ isCompleted: false, recurrenceRule: WEEKLY })
    expect(await stored(id)).toMatchObject({ isCompleted: false, recurrenceRule: WEEKLY })
  })

  it('a task edit drops it in the store as in the database; Undo brings it back', async () => {
    const id = await orphanTask()
    await useTodoStore.getState().update(id, { title: 'Water the plants' })
    expect(mem(id).recurrenceRule).toBeUndefined()
    expect((await stored(id)).recurrenceRule).toBeUndefined()

    await useUndoStore.getState().undo()
    expect(mem(id)).toMatchObject({ title: 'Water plants', recurrenceRule: WEEKLY })
    expect(await stored(id)).toMatchObject({ title: 'Water plants', recurrenceRule: WEEKLY })
  })

  it('clearing the due dates drops their rules in the store too; Undo brings both back', async () => {
    const id = await useTodoStore.getState().add('Report')
    const due = new Date(2026, 9, 30)
    await useTodoStore.getState().update(id, { dueDate: due, recurrenceRule: WEEKLY })
    useUndoStore.getState().clear()

    await useTodoStore.getState().bulkClearDueDate([id])
    for (const row of [mem(id), await stored(id)]) {
      expect(row.dueDate).toBeUndefined()
      expect(row.recurrenceRule).toBeUndefined()
    }

    await useUndoStore.getState().undo()
    expect(mem(id).dueDate?.getTime()).toBe(due.getTime())
    expect(mem(id).recurrenceRule).toEqual(WEEKLY)
    expect(await stored(id)).toMatchObject({ dueDate: due, recurrenceRule: WEEKLY })
  })
})
