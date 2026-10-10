import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'

/**
 * cr1 P4 regression: the store's optimistic `completedAt` and the stored one
 * must be the *same* instant. The repository write runs after the optimistic
 * update, so a clock tick in between exposed two independently minted
 * timestamps (and the next save spread the store's value over the DB's).
 * Each repository write path advances a fake clock by 5 ms before running,
 * which made the split deterministic.
 */

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState({ todos: [], todosVersion: 0, loading: false })
  useUndoStore.getState().clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
  for (const method of ['update', 'complete', 'bulkUpdate'] as const) {
    const orig = todoRepository[method].bind(todoRepository) as (...a: unknown[]) => Promise<void>
    vi.spyOn(todoRepository, method).mockImplementation(async (...args: unknown[]) => {
      vi.setSystemTime(Date.now() + 5)
      return orig(...args)
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function expectInSync(id: number, label: string) {
  const row = (await db.todos.get(id))!
  const mem = useTodoStore.getState().todos.find((t) => t.id === id)!
  expect(mem.completedAt?.getTime(), `${label}: store completedAt === DB completedAt`).toBe(row.completedAt?.getTime())
}

describe('store and DB agree on completedAt', () => {
  it('toggleComplete', async () => {
    const id = await useTodoStore.getState().add('T')
    await useTodoStore.getState().toggleComplete(id)
    await expectInSync(id, 'complete')
    await useTodoStore.getState().toggleComplete(id)
    await expectInSync(id, 'reopen')
  })

  it('update() completing, then an unrelated edit keeps the stored time', async () => {
    const id = await useTodoStore.getState().add('U')
    const mem = () => useTodoStore.getState().todos.find((t) => t.id === id)!
    await useTodoStore.getState().update({ ...mem(), isCompleted: true })
    await expectInSync(id, 'update complete')
    const at = (await db.todos.get(id))!.completedAt
    await useTodoStore.getState().update({ ...mem(), title: 'Renamed' })
    expect((await db.todos.get(id))!.completedAt).toEqual(at)
    await expectInSync(id, 'unrelated edit')
  })

  it('bulkSetCompleted and its undo', async () => {
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().add('B')
    await useTodoStore.getState().bulkSetCompleted([a, b], true)
    await expectInSync(a, 'bulk complete a')
    await expectInSync(b, 'bulk complete b')
    useUndoStore.getState().clear()
    await useTodoStore.getState().bulkSetCompleted([a], false)
    await useUndoStore.getState().undo()
    await expectInSync(a, 'undo bulk reopen')
  })
})
