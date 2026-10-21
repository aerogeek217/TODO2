import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useListOrderStore } from '../../stores/list-order-store'
import { useTodoStore } from '../../stores/todo-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { emptyPredicate } from '../../models'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'

async function addTodo(title: string): Promise<number> {
  const now = new Date()
  return db.todos.add({ uid: `uid-${title}`, title, isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 })
}

async function addList(name: string): Promise<number> {
  return db.listDefinitions.add({
    name, sortOrder: 0, sort: 'manual', grouping: 'none',
    membership: { kind: 'custom', predicate: emptyPredicate() },
  })
}

beforeEach(async () => {
  await resetDb()
  useListOrderStore.setState(useListOrderStore.getInitialState())
  useTodoStore.setState({ todos: [] })
  useListDefinitionStore.setState({ listDefinitions: [] })
  useUndoStore.getState().clear()
})

describe('list-order-store', () => {
  it('setRanks saves at once and loads back', async () => {
    const a = await addTodo('a')
    const list = await addList('L')
    await useListOrderStore.getState().setRanks(list, [{ todoId: a, rank: 3 }])
    expect(useListOrderStore.getState().ranks.get(list)?.get(a)).toBe(3)
    useListOrderStore.setState(useListOrderStore.getInitialState())
    await useListOrderStore.getState().ensureLoaded()
    expect(useListOrderStore.getState().ranks.get(list)?.get(a)).toBe(3)
  })

  it('replaceList drops ranks of tasks not in the new order', async () => {
    const a = await addTodo('a')
    const b = await addTodo('b')
    const list = await addList('L')
    await useListOrderStore.getState().setRanks(list, [{ todoId: a, rank: 1 }, { todoId: b, rank: 2 }])
    await useListOrderStore.getState().replaceList(list, [{ todoId: b, rank: 1 }])
    expect([...(useListOrderStore.getState().ranks.get(list) ?? [])]).toEqual([[b, 1]])
    expect((await db.listOrders.toArray()).map((r) => r.todoId)).toEqual([b])
  })

  it('deleting a task drops its ranks; undo puts them back', async () => {
    const a = await addTodo('a')
    const list = await addList('L')
    await useTodoStore.getState().loadAll()
    await useListOrderStore.getState().setRanks(list, [{ todoId: a, rank: 7 }])
    await useTodoStore.getState().remove(a)
    expect(useListOrderStore.getState().ranks.get(list)).toBeUndefined()
    expect(await db.listOrders.count()).toBe(0)
    await useUndoStore.getState().undo()
    expect(useListOrderStore.getState().ranks.get(list)?.get(a)).toBe(7)
    expect(await db.listOrders.count()).toBe(1)
  })
})

describe('list-order-store reads that fail', () => {
  it('load never rejects: reported, ranks kept, a refresh of every store still completes', async () => {
    const { vi } = await import('vitest')
    const { listOrderRepository } = await import('../../data/list-order-repository')
    const { refreshAllStores } = await import('../../stores/refresh-all')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const spy = vi.spyOn(listOrderRepository, 'getAll').mockRejectedValue(new Error('read failed'))
    try {
      await expect(useListOrderStore.getState().load()).resolves.toBeUndefined()
      expect(useListOrderStore.getState().loaded).toBe(false)
      await expect(refreshAllStores()).resolves.toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })
})
