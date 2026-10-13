// `useTodoStore.update(id, changes)` writes only the fields an edit changes,
// so an edit can't put back an older value of a field another write changed.
// Each interleaving test holds one write at a chosen point and runs the
// other in between.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

const due = new Date(2026, 5, 15)

async function addTodo(title: string): Promise<number> {
  const now = new Date()
  return db.todos.add({ uid: `uid-${title}`, title, isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1 })
}

const inStore = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)!
const inDb = async (id: number) => (await todoRepository.getById(id))!

beforeEach(async () => {
  await resetDb()
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useUndoStore.getState().clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useTodoStore.update(id, changes) writes only the changed fields', () => {
  it('writes the changed field and leaves the others as the database holds them', async () => {
    const id = await addTodo('Task')
    await useTodoStore.getState().loadAll()
    const spy = vi.spyOn(todoRepository, 'update')

    await useTodoStore.getState().update(id, { title: 'Renamed' })

    expect(spy).toHaveBeenCalledWith(id, { title: 'Renamed' })
    expect((await inDb(id)).title).toBe('Renamed')
  })

  it('an edit with no change writes nothing and adds no undo step', async () => {
    const id = await addTodo('Task')
    await useTodoStore.getState().loadAll()
    const spy = vi.spyOn(todoRepository, 'update')

    await useTodoStore.getState().update(id, { title: inStore(id).title, statusId: undefined })

    expect(spy).not.toHaveBeenCalled()
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('a cleared field is removed', async () => {
    const id = await addTodo('Task')
    await todoRepository.update(id, { notes: 'old notes', dueDate: due })
    await useTodoStore.getState().loadAll()

    await useTodoStore.getState().update(id, { notes: undefined, dueDate: undefined })

    const row = await inDb(id)
    expect(row.notes).toBeUndefined()
    expect(row.dueDate).toBeUndefined()
    expect(inStore(id).notes).toBeUndefined()
  })

  it('an edit landing while another write is between its database write and its store update keeps that write', async () => {
    // Undo of a bulk due-date change writes the database first, then the
    // store. A notes keystroke in between reads the store's older due date.
    const id = await addTodo('Task')
    await useTodoStore.getState().loadAll()
    await useTodoStore.getState().bulkSetDeadline([id], due)
    expect((await inDb(id)).dueDate).toEqual(due)

    const written = deferred()
    const release = deferred()
    const realBulkUpdate = todoRepository.bulkUpdate.bind(todoRepository)
    vi.spyOn(todoRepository, 'bulkUpdate').mockImplementationOnce(async (mutations) => {
      await realBulkUpdate(mutations)
      written.resolve()
      await release.promise
    })

    const undo = useUndoStore.getState().undo()
    await written.promise
    // The store still shows the bulk due date; the database no longer has it.
    expect(inStore(id).dueDate).toEqual(due)
    await useTodoStore.getState().update(id, { notes: 'typed meanwhile' })
    release.resolve()
    await undo

    const row = await inDb(id)
    expect(row.notes).toBe('typed meanwhile')
    expect(row.dueDate).toBeUndefined()
    expect(inStore(id).dueDate).toBeUndefined()
  })

  it('undo of an edit restores only the fields it changed', async () => {
    const id = await addTodo('Old title')
    await useTodoStore.getState().loadAll()

    await useTodoStore.getState().update(id, { title: 'New title' })
    await useTodoStore.getState().bulkSetFocus([id], true)
    // Undo the title edit while the later focus change stays: take the focus
    // entry off the stack so the title edit is on top.
    const stack = useUndoStore.getState().undoStack
    useUndoStore.setState({ undoStack: stack.slice(0, 1) })
    await useUndoStore.getState().undo()

    expect(inStore(id)).toMatchObject({ title: 'Old title', focus: true })
    expect(await inDb(id)).toMatchObject({ title: 'Old title', focus: true })

    await useUndoStore.getState().redo()
    expect(inStore(id)).toMatchObject({ title: 'New title', focus: true })
    expect(await inDb(id)).toMatchObject({ title: 'New title', focus: true })
  })

  it('a failed write rolls back only its own fields', async () => {
    const id = await addTodo('Old title')
    await useTodoStore.getState().loadAll()
    const fail = deferred()
    vi.spyOn(todoRepository, 'update').mockImplementationOnce(async () => {
      await fail.promise
      throw new Error('DB error')
    })

    const edit = useTodoStore.getState().update(id, { title: 'New title' })
    const rejected = expect(edit).rejects.toThrow('DB error')
    await useTodoStore.getState().bulkSetFocus([id], true)
    fail.resolve()
    await rejected

    expect(inStore(id)).toMatchObject({ title: 'Old title', focus: true })
    expect(await inDb(id)).toMatchObject({ title: 'Old title', focus: true })
  })

  it('completing through update stamps completedAt once, in the store and the database', async () => {
    const id = await addTodo('Task')
    await useTodoStore.getState().loadAll()

    await useTodoStore.getState().update(id, { isCompleted: true })

    const stamped = inStore(id).completedAt
    expect(stamped).toBeInstanceOf(Date)
    expect((await inDb(id)).completedAt).toEqual(stamped)
  })
})
