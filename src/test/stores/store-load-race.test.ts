// A store `load()` whose read was in flight while an edit landed must not put
// the pre-edit rows back (`trackWrite` / `readFresh` in store-helpers). Each
// test pins the interleaving: the load's read completes with the old rows and
// is held, the edit runs, then the read is released.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { listDefinitionRepository } from '../../data/list-definition-repository'
import { listOrderRepository } from '../../data/list-order-repository'
import {
  personRepository,
  settingsRepository,
  statusRepository,
  tagRepository,
  todoRepository,
} from '../../data'
import { readFresh, trackWrite } from '../../stores/store-helpers'
import { useTodoStore } from '../../stores/todo-store'
import { useTagStore } from '../../stores/tag-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { emptyPredicate } from '../../models'
import { useListOrderStore } from '../../stores/list-order-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

interface Gate {
  /** Resolves once the held read has its (pre-edit) result. */
  read: Promise<void>
  release: () => void
}

/**
 * Makes the next call of `target[key]` read at once and then wait for
 * `release()` before returning — later calls run normally.
 */
function holdNextRead<T extends object>(target: T, key: keyof T & string): Gate {
  const original = (target[key] as (...args: unknown[]) => Promise<unknown>).bind(target)
  let release!: () => void
  let readDone!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const read = new Promise<void>((r) => { readDone = r })
  vi.spyOn(target, key as never).mockImplementationOnce((async (...args: unknown[]) => {
    const rows = await original(...args)
    readDone()
    await gate
    return rows
  }) as never)
  return { read, release }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

async function addTodo(title: string): Promise<number> {
  const now = new Date()
  return db.todos.add({ uid: `uid-${title}`, title, isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1 })
}

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('load vs. edit', () => {
  it('a todo edit made during loadAll survives the load', async () => {
    const id = await addTodo('Old title')
    await useTodoStore.getState().loadAll()
    const gate = holdNextRead(todoRepository, 'getAll')
    const getAll = vi.mocked(todoRepository.getAll)

    const load = useTodoStore.getState().loadAll()
    await gate.read
    const todo = useTodoStore.getState().todos.find((t) => t.id === id)!
    await useTodoStore.getState().update(todo.id, { title: 'New title' })
    gate.release()
    await load

    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.title).toBe('New title')
    expect(getAll).toHaveBeenCalledTimes(2)
  })

  it('a load waits for a write still in flight before it reads', async () => {
    const id = await addTodo('Old title')
    await useTodoStore.getState().loadAll()
    const persist = deferred()
    const realUpdate = todoRepository.update.bind(todoRepository)
    vi.spyOn(todoRepository, 'update').mockImplementationOnce(async (id, changes) => {
      await persist.promise
      await realUpdate(id, changes)
    })
    const getAll = vi.spyOn(todoRepository, 'getAll')

    const todo = useTodoStore.getState().todos.find((t) => t.id === id)!
    const edit = useTodoStore.getState().update(todo.id, { title: 'New title' })
    const load = useTodoStore.getState().loadAll()
    await new Promise((r) => setTimeout(r, 0))
    expect(getAll).not.toHaveBeenCalled()

    persist.resolve()
    await Promise.all([edit, load])
    expect(getAll).toHaveBeenCalledTimes(1)
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.title).toBe('New title')
  })

  it('a task added during loadAll is listed once', async () => {
    await addTodo('Existing')
    const gate = holdNextRead(todoRepository, 'getAll')

    const load = useTodoStore.getState().loadAll()
    await gate.read
    const id = await useTodoStore.getState().add('Added meanwhile')
    gate.release()
    await load

    expect(useTodoStore.getState().todos.filter((t) => t.id === id)).toHaveLength(1)
    expect(useTodoStore.getState().todos.map((t) => t.title).sort()).toEqual(['Added meanwhile', 'Existing'])
  })

  it('a tag rename made during load survives the load', async () => {
    const tagId = await db.tags.add({ name: 'old', color: '#111111' })
    await useTagStore.getState().load()
    const gate = holdNextRead(tagRepository, 'getAll')

    const load = useTagStore.getState().load()
    await gate.read
    await useTagStore.getState().update({ id: tagId, name: 'new', color: '#111111' })
    gate.release()
    await load

    expect(useTagStore.getState().tags.map((t) => t.name)).toEqual(['new'])
  })

  it('a person created during load is kept (once)', async () => {
    const gate = holdNextRead(personRepository, 'getAll')

    const load = usePersonStore.getState().load()
    await gate.read
    const id = await usePersonStore.getState().getOrCreate('Dana')
    gate.release()
    await load

    expect(usePersonStore.getState().people.filter((p) => p.id === id)).toHaveLength(1)
  })

  it('a status reorder made during load survives the load', async () => {
    await db.statuses.bulkAdd([
      { name: 'A', color: '#111111', sortOrder: 0, icon: 'circle' },
      { name: 'B', color: '#222222', sortOrder: 1, icon: 'circle' },
    ])
    await useStatusStore.getState().load()
    const gate = holdNextRead(statusRepository, 'getAll')

    const load = useStatusStore.getState().load()
    await gate.read
    await useStatusStore.getState().reorder(1, 0)
    gate.release()
    await load

    const byOrder = [...useStatusStore.getState().statuses].sort((a, b) => a.sortOrder - b.sortOrder)
    expect(byOrder.map((s) => s.name)).toEqual(['B', 'A'])
  })

  it('a list edit made during load survives the load', async () => {
    const id = await db.listDefinitions.add({
      name: 'Old', sortOrder: 0, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: emptyPredicate() },
    })
    await useListDefinitionStore.getState().load()
    const gate = holdNextRead(listDefinitionRepository, 'getAll')

    const load = useListDefinitionStore.getState().load()
    await gate.read
    const def = useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)!
    await useListDefinitionStore.getState().update({ ...def, name: 'New' })
    gate.release()
    await load

    expect(useListDefinitionStore.getState().listDefinitions.map((d) => d.name)).toEqual(['New'])
  })

  it('a manual-order change made during load survives the load', async () => {
    const gate = holdNextRead(listOrderRepository, 'getAll')

    const load = useListOrderStore.getState().load()
    await gate.read
    await useListOrderStore.getState().setRanks(7, [{ todoId: 3, rank: 1 }])
    gate.release()
    await load

    expect(useListOrderStore.getState().ranks.get(7)?.get(3)).toBe(1)
  })

  it('a setting changed during load survives the load', async () => {
    const gate = holdNextRead(settingsRepository, 'getAll')

    const load = useSettingsStore.getState().load()
    await gate.read
    await useSettingsStore.getState().setCheckinOpenMethod('eml')
    gate.release()
    await load

    expect(useSettingsStore.getState().checkinOpenMethod).toBe('eml')
  })
})

describe('readFresh', () => {
  it('reads again after a write that started and finished during the read', async () => {
    let reads = 0
    const write = deferred()
    const result = readFresh(async () => {
      reads++
      if (reads === 1) {
        await trackWrite(async () => { write.resolve() })
      }
      return reads
    })
    await write.promise
    expect(await result).toBe(2)
  })

  it('is not held up by a write that failed', async () => {
    const failed = trackWrite(() => Promise.reject(new Error('nope')))
    await expect(failed).rejects.toThrow('nope')
    expect(await readFresh(async () => 'read')).toBe('read')
  })

  it('stops re-reading after five reads that each overlapped a write', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let reads = 0
    const result = await readFresh(async () => {
      reads++
      await trackWrite(async () => {})
      return reads
    })
    expect(result).toBe(5)
    expect(warn).toHaveBeenCalledOnce()
  })
})
