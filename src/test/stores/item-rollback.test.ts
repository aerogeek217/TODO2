// A failed optimistic write rolls back only what it changed: another edit
// that landed while its database write was in flight keeps its value. Each
// test holds the failing write, lands the other edit, then fails the held
// write.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { personRepository, statusRepository, tagRepository } from '../../data'
import { listDefinitionRepository } from '../../data/list-definition-repository'
import { createAssignmentActions } from '../../stores/assignment-helpers'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useStatusStore } from '../../stores/status-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'

interface Held {
  /** Rejects the held write. */
  fail: () => void
}

/** Makes the next call of `target[key]` wait, then reject when `fail()` is called. */
function holdNextWriteToFail<T extends object>(target: T, key: keyof T & string): Held {
  let fail!: () => void
  const gate = new Promise<void>((resolve) => { fail = resolve })
  vi.spyOn(target, key as never).mockImplementationOnce((async () => {
    await gate
    throw new Error('write failed')
  }) as never)
  return { fail }
}

beforeEach(async () => {
  await resetDb()
  for (const store of [usePersonStore, useTagStore, useStatusStore, useListDefinitionStore]) {
    store.setState(store.getInitialState(), true)
  }
  useUndoStore.getState().clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('assignment maps', () => {
  interface E { id?: number; name: string }
  const A: E = { id: 1, name: 'A' }
  const B: E = { id: 2, name: 'B' }

  function setup(initial: Map<number, E[]> = new Map()) {
    let map = initial
    const repo = {
      assign: vi.fn(async () => {}),
      unassign: vi.fn(async () => {}),
      getForTodos: vi.fn(async () => new Map<number, E[]>()),
    }
    /** The next repo write of `kind` waits, then fails on `fail()`. */
    const holdNext = (kind: 'assign' | 'unassign'): Held => {
      let fail!: () => void
      const gate = new Promise<void>((r) => { fail = r })
      repo[kind].mockImplementationOnce(async () => {
        await gate
        throw new Error('write failed')
      })
      return { fail }
    }
    const actions = createAssignmentActions<E>(
      { repo, label: 'entity', getName: (e) => e.name },
      () => [A, B],
      () => map,
      (m) => { map = m },
    )
    return { actions, holdNext, getMap: () => map }
  }

  const ids = (list: E[] | undefined) => (list ?? []).map((e) => e.id)

  it('a failed assign keeps an assignment made to another task meanwhile', async () => {
    const { actions, holdNext, getMap } = setup()
    const held = holdNext('assign')
    const failing = actions.assign(10, A.id!)
    await actions.assign(20, B.id!)
    held.fail()
    await expect(failing).rejects.toThrow('write failed')
    expect(ids(getMap().get(10))).toEqual([])
    expect(ids(getMap().get(20))).toEqual([B.id])
  })

  it('a failed unassign puts the entity back and keeps another change', async () => {
    const { actions, holdNext, getMap } = setup(new Map([[10, [A]]]))
    const held = holdNext('unassign')
    const failing = actions.unassign(10, A.id!)
    await actions.assign(20, B.id!)
    held.fail()
    await expect(failing).rejects.toThrow('write failed')
    expect(ids(getMap().get(10))).toEqual([A.id])
    expect(ids(getMap().get(20))).toEqual([B.id])
  })

  it('a failed bulk assign keeps an assignment made to another task meanwhile', async () => {
    const { actions, holdNext, getMap } = setup()
    const held = holdNext('assign')
    const failing = actions.bulkAssign([10, 11], A.id!)
    await actions.assign(20, B.id!)
    held.fail()
    await expect(failing).rejects.toThrow('write failed')
    expect(ids(getMap().get(10))).toEqual([])
    expect(ids(getMap().get(11))).toEqual([])
    expect(ids(getMap().get(20))).toEqual([B.id])
  })

  it('a failed bulk unassign puts the entity back and keeps another change', async () => {
    const { actions, holdNext, getMap } = setup(new Map([[10, [A]], [11, [A, B]]]))
    const held = holdNext('unassign')
    const failing = actions.bulkUnassign([10, 11], A.id!)
    await actions.assign(20, B.id!)
    held.fail()
    await expect(failing).rejects.toThrow('write failed')
    expect(ids(getMap().get(10))).toEqual([A.id])
    expect(ids(getMap().get(11))).toEqual([A.id, B.id])
    expect(ids(getMap().get(20))).toEqual([B.id])
  })

  it('a failed assign keeps an unassign of another entity on the same task', async () => {
    const { actions, holdNext, getMap } = setup(new Map([[10, [B]]]))
    const held = holdNext('assign')
    const failing = actions.assign(10, A.id!)
    await actions.unassign(10, B.id!)
    held.fail()
    await expect(failing).rejects.toThrow('write failed')
    expect(ids(getMap().get(10))).toEqual([])
  })
})

describe('entity updates', () => {
  async function todoWith(personId: number, tagId: number): Promise<number> {
    const now = new Date()
    const todoId = await db.todos.add({ uid: 'u1', title: 'T', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1 })
    await db.todoPeople.add({ todoId, personId })
    await db.todoTags.add({ todoId, tagId })
    return todoId
  }

  it('a failed person update keeps another person edited meanwhile', async () => {
    const alice = await usePersonStore.getState().add('Alice', 'A')
    const bob = await usePersonStore.getState().add('Bob', 'B')
    const todoId = await todoWith(bob, 0)
    await usePersonStore.getState().loadAssignments([todoId])

    const held = holdNextWriteToFail(personRepository, 'update')
    const failing = usePersonStore.getState().update({ id: alice, name: 'Alice 2', initials: 'A' })
    await usePersonStore.getState().update({ id: bob, name: 'Bob 2', initials: 'B' })
    held.fail()
    await expect(failing).rejects.toThrow('write failed')

    const names = usePersonStore.getState().people.map((p) => p.name).sort()
    expect(names).toEqual(['Alice', 'Bob 2'])
    expect(usePersonStore.getState().assignedPeopleMap.get(todoId)?.map((p) => p.name)).toEqual(['Bob 2'])
  })

  it('a failed person update leaves a later edit of the same person alone', async () => {
    const alice = await usePersonStore.getState().add('Alice', 'A')
    const held = holdNextWriteToFail(personRepository, 'update')
    const failing = usePersonStore.getState().update({ id: alice, name: 'Alice 2', initials: 'A' })
    await usePersonStore.getState().update({ id: alice, name: 'Alice 3', initials: 'A' })
    held.fail()
    await expect(failing).rejects.toThrow('write failed')
    expect(usePersonStore.getState().people.map((p) => p.name)).toEqual(['Alice 3'])
  })

  it('a failed tag update keeps another tag edited meanwhile', async () => {
    const work = await useTagStore.getState().add('work')
    const home = await useTagStore.getState().add('home')
    const todoId = await todoWith(0, home)
    await useTagStore.getState().loadAssignments([todoId])

    const held = holdNextWriteToFail(tagRepository, 'update')
    const failing = useTagStore.getState().update({ id: work, name: 'job', color: '#111111' })
    await useTagStore.getState().update({ id: home, name: 'house', color: '#222222' })
    held.fail()
    await expect(failing).rejects.toThrow('write failed')

    expect(useTagStore.getState().tags.map((t) => t.name).sort()).toEqual(['house', 'work'])
    expect(useTagStore.getState().assignedTagsMap.get(todoId)?.map((t) => t.name)).toEqual(['house'])
  })

  it('a failed status update keeps another status edited meanwhile', async () => {
    const open = await useStatusStore.getState().add('Open')
    const done = await useStatusStore.getState().add('Done')
    const before = useStatusStore.getState().statuses
    const statusOf = (id: number) => before.find((s) => s.id === id)!

    const held = holdNextWriteToFail(statusRepository, 'update')
    const failing = useStatusStore.getState().update({ ...statusOf(open), name: 'Open 2' })
    await useStatusStore.getState().update({ ...statusOf(done), name: 'Done 2' })
    held.fail()
    await expect(failing).rejects.toThrow('write failed')

    expect(useStatusStore.getState().statuses.map((s) => s.name).sort()).toEqual(['Done 2', 'Open'])
  })

  it('a failed list update keeps another list edited meanwhile', async () => {
    const a = await useListDefinitionStore.getState().add({ name: 'A' })
    const b = await useListDefinitionStore.getState().add({ name: 'B' })
    const defOf = (id: number) => useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)!

    const held = holdNextWriteToFail(listDefinitionRepository, 'update')
    const failing = useListDefinitionStore.getState().update({ ...defOf(a), name: 'A 2' })
    await useListDefinitionStore.getState().update({ ...defOf(b), name: 'B 2' })
    held.fail()
    await expect(failing).rejects.toThrow('write failed')

    expect(useListDefinitionStore.getState().listDefinitions.map((d) => d.name).sort()).toEqual(['A', 'B 2'])
  })
})
