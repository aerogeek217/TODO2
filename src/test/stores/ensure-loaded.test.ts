// `ensureLoaded()` loads a store once. A failed load is reported to the user
// and is not "loaded": the next `ensureLoaded()` reads again.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { listDefinitionRepository } from '../../data/list-definition-repository'
import { listOrderRepository } from '../../data/list-order-repository'
import { personRepository, statusRepository, tagRepository, todoRepository } from '../../data'
import { makeEnsureLoaded } from '../../stores/store-helpers'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useStatusStore } from '../../stores/status-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

const STORES = [useTodoStore, usePersonStore, useTagStore, useStatusStore, useListDefinitionStore, useListOrderStore]

beforeEach(async () => {
  await resetDb()
  for (const store of STORES) store.setState(store.getInitialState(), true)
  useUndoStore.getState().clear()
  useUndoStore.getState().dismissSnackbar()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('makeEnsureLoaded', () => {
  it('concurrent callers share one load; a failed load is retried by the next call', async () => {
    let loaded = false
    let calls = 0
    const gate = deferred()
    const load = vi.fn(async () => {
      calls++
      if (calls === 1) {
        await gate.promise
        return // failed: `loaded` stays false
      }
      loaded = true
    })
    const ensure = makeEnsureLoaded(load, () => loaded)

    const a = ensure()
    const b = ensure()
    expect(load).toHaveBeenCalledTimes(1)
    gate.resolve()
    await Promise.all([a, b])
    expect(loaded).toBe(false)

    await ensure()
    expect(load).toHaveBeenCalledTimes(2)
    expect(loaded).toBe(true)

    await ensure()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('never rejects, even when the load throws', async () => {
    const ensure = makeEnsureLoaded(() => Promise.reject(new Error('boom')), () => false)
    await expect(ensure()).resolves.toBeUndefined()
  })
})

describe('a store whose first load fails', () => {
  const cases = [
    {
      name: 'tasks',
      repo: todoRepository as object, key: 'getAll',
      ensure: () => useTodoStore.getState().ensureAllLoaded(),
      seed: async () => { await db.todos.add({ uid: 'u1', title: 'T', isCompleted: false, createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1 }) },
      count: () => useTodoStore.getState().todos.length,
    },
    {
      name: 'people',
      repo: personRepository as object, key: 'getAll',
      ensure: () => usePersonStore.getState().ensureLoaded(),
      seed: async () => { await db.people.add({ name: 'Ann', initials: 'A' }) },
      count: () => usePersonStore.getState().people.length,
    },
    {
      name: 'tags',
      repo: tagRepository as object, key: 'getAll',
      ensure: () => useTagStore.getState().ensureLoaded(),
      seed: async () => { await db.tags.add({ name: 'x', color: '#111111' }) },
      count: () => useTagStore.getState().tags.length,
    },
    {
      name: 'statuses',
      repo: statusRepository as object, key: 'getAll',
      ensure: () => useStatusStore.getState().ensureLoaded(),
      seed: async () => {
        await useStatusStore.getState().add('Doing')
        useStatusStore.setState(useStatusStore.getInitialState(), true)
      },
      count: () => useStatusStore.getState().statuses.length,
    },
    {
      name: 'saved lists',
      repo: listDefinitionRepository as object, key: 'getAll',
      ensure: () => useListDefinitionStore.getState().ensureLoaded(),
      seed: async () => {
        await useListDefinitionStore.getState().add({ name: 'L' })
        useListDefinitionStore.setState(useListDefinitionStore.getInitialState(), true)
      },
      count: () => useListDefinitionStore.getState().listDefinitions.length,
    },
  ]

  for (const c of cases) {
    it(`${c.name}: reported, not marked loaded, and read again by the next ensureLoaded`, async () => {
      await c.seed()
      const spy = vi.spyOn(c.repo as Record<string, () => Promise<unknown>>, c.key)
        .mockRejectedValueOnce(new Error('IDB unavailable'))

      await c.ensure()
      expect(c.count()).toBe(0)
      expect(useUndoStore.getState().snackbar).toEqual({
        description: `Couldn't load ${c.name}. Reload the page to try again.`,
        notice: true,
      })

      await c.ensure()
      expect(c.count()).toBe(1)
      expect(spy).toHaveBeenCalledTimes(2)

      await c.ensure()
      expect(spy).toHaveBeenCalledTimes(2)
    })
  }

  it('manual order: reported, never an unhandled rejection, and read again next time', async () => {
    const spy = vi.spyOn(listOrderRepository, 'getAll').mockRejectedValueOnce(new Error('IDB unavailable'))

    await expect(useListOrderStore.getState().ensureLoaded()).resolves.toBeUndefined()
    expect(useListOrderStore.getState().loaded).toBe(false)
    expect(useUndoStore.getState().snackbar?.description).toBe("Couldn't load the manual task order. Reload the page to try again.")

    await useListOrderStore.getState().ensureLoaded()
    expect(useListOrderStore.getState().loaded).toBe(true)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('callers that arrive while the failing read is in flight share it; the next caller reads again', async () => {
    await db.people.add({ name: 'Ann', initials: 'A' })
    const gate = deferred()
    const realGetAll = personRepository.getAll.bind(personRepository)
    const spy = vi.spyOn(personRepository, 'getAll').mockImplementationOnce(async () => {
      await gate.promise
      throw new Error('IDB unavailable')
    })

    const first = usePersonStore.getState().ensureLoaded()
    const second = usePersonStore.getState().ensureLoaded()
    gate.resolve()
    await Promise.all([first, second])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(usePersonStore.getState().loaded).toBe(false)

    spy.mockImplementation(realGetAll)
    await usePersonStore.getState().ensureLoaded()
    expect(usePersonStore.getState().people.map((p) => p.name)).toEqual(['Ann'])
  })
})
