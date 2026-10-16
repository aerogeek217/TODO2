// Writes that start together must not act on a snapshot taken before the
// other's await: concurrent adds each get their own sort order, and a list
// delete keeps a list edited while it ran.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { listOrderRepository } from '../../data/list-order-repository'
import { useTodoStore } from '../../stores/todo-store'
import { useStatusStore } from '../../stores/status-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const sortOrders = async () => (await db.todos.toArray()).map((t) => t.sortOrder).sort((a, b) => a - b)

describe('concurrent adds get distinct sort orders', () => {
  it('two task adds', async () => {
    await useTodoStore.getState().add('First')
    await Promise.all([useTodoStore.getState().add('A'), useTodoStore.getState().add('B')])
    expect(await sortOrders()).toEqual([1, 2, 3])
    expect(useTodoStore.getState().todos.map((t) => t.sortOrder).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('a task add next to an add of several', async () => {
    await Promise.all([
      useTodoStore.getState().addMany(
        [{ todo: newTodo('M1'), personIds: [], tagIds: [] }, { todo: newTodo('M2'), personIds: [], tagIds: [] }],
        { description: 'Add 2 tasks' },
      ),
      useTodoStore.getState().add('A'),
    ])
    expect(new Set(await sortOrders()).size).toBe(3)
  })

  it('a duplicate next to a task add', async () => {
    const id = await useTodoStore.getState().add('Original')
    await Promise.all([useTodoStore.getState().duplicate(id), useTodoStore.getState().add('A')])
    expect(await sortOrders()).toEqual([1, 2, 3])
  })

  it('a new task goes after the highest sort order in the database, loaded or not', async () => {
    const now = new Date()
    await db.todos.add({ uid: 'x', title: 'Not loaded', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 41 })
    await useTodoStore.getState().add('New')
    expect(await sortOrders()).toEqual([41, 42])
  })

  it('two list adds', async () => {
    await Promise.all([
      useListDefinitionStore.getState().add({ name: 'A' }),
      useListDefinitionStore.getState().add({ name: 'B' }),
    ])
    const stored = (await db.listDefinitions.toArray()).map((d) => d.sortOrder).sort()
    expect(stored).toEqual([0, 1])
    expect(useListDefinitionStore.getState().listDefinitions.map((d) => d.sortOrder).sort()).toEqual([0, 1])
  })

  it('two status adds', async () => {
    await Promise.all([
      useStatusStore.getState().add('Open'),
      useStatusStore.getState().add('Done'),
    ])
    const stored = (await db.statuses.toArray()).map((s) => s.sortOrder).sort()
    expect(stored).toEqual([1, 2])
    expect(useStatusStore.getState().statuses.map((s) => s.sortOrder).sort()).toEqual([1, 2])
  })
})

describe('list delete', () => {
  it('keeps a list edited while the delete ran', async () => {
    const a = await useListDefinitionStore.getState().add({ name: 'A' })
    const b = await useListDefinitionStore.getState().add({ name: 'B' })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const getByList = listOrderRepository.getByList.bind(listOrderRepository)
    vi.spyOn(listOrderRepository, 'getByList').mockImplementationOnce(async (id) => {
      const rows = await getByList(id)
      await gate
      return rows
    })

    const removing = useListDefinitionStore.getState().remove(a)
    const defB = useListDefinitionStore.getState().listDefinitions.find((d) => d.id === b)!
    const editing = useListDefinitionStore.getState().update({ ...defB, name: 'B 2' })
    release()
    await Promise.all([removing, editing])

    expect(useListDefinitionStore.getState().listDefinitions.map((d) => d.name)).toEqual(['B 2'])
  })

  it('keeps a list added while the delete ran', async () => {
    const a = await useListDefinitionStore.getState().add({ name: 'A' })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const getByList = listOrderRepository.getByList.bind(listOrderRepository)
    vi.spyOn(listOrderRepository, 'getByList').mockImplementationOnce(async (id) => {
      const rows = await getByList(id)
      await gate
      return rows
    })

    const removing = useListDefinitionStore.getState().remove(a)
    const adding = useListDefinitionStore.getState().add({ name: 'C' })
    await adding
    release()
    await removing

    expect(useListDefinitionStore.getState().listDefinitions.map((d) => d.name)).toEqual(['C'])
  })
})

function newTodo(title: string) {
  const now = new Date()
  return { title, isCompleted: false, createdAt: now, modifiedAt: now }
}
