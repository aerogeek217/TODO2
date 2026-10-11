import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { DEFAULT_FOLLOWUP_INTERVAL } from '../../utils/followup'

// Sat 10 Oct 2026, 15:30 local.
const NOW = new Date(2026, 9, 10, 15, 30)
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState({ todos: [], todosVersion: 0, loading: false })
  useUndoStore.getState().clear()
  useSettingsStore.setState({ followupDefaultInterval: DEFAULT_FOLLOWUP_INTERVAL, defaultStatusId: null })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const mem = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)!

describe('new tasks get the default next follow-up', () => {
  it('add(): today + 1 month (the default), at local midnight; no last follow-up', async () => {
    const id = await useTodoStore.getState().add('A')
    const row = (await db.todos.get(id))!
    expect(row.nextFollowupAt).toEqual(day(2026, 11, 10))
    expect(row.lastFollowupAt).toBeUndefined()
    expect(mem(id).nextFollowupAt).toEqual(day(2026, 11, 10))
  })

  it('add() follows the Settings interval', async () => {
    useSettingsStore.setState({ followupDefaultInterval: { count: 10, unit: 'd' } })
    const id = await useTodoStore.getState().add('B')
    expect((await db.todos.get(id))!.nextFollowupAt).toEqual(day(2026, 10, 20))
  })

  it('duplicate() copies the source next follow-up but not the last one', async () => {
    const id = await useTodoStore.getState().add('C')
    await useTodoStore.getState().update({ ...mem(id), nextFollowupAt: day(2026, 12, 1), lastFollowupAt: day(2026, 10, 1) })
    const copy = (await useTodoStore.getState().duplicate(id))!
    const row = (await db.todos.get(copy))!
    expect(row.nextFollowupAt).toEqual(day(2026, 12, 1))
    expect(row.lastFollowupAt).toBeUndefined()
  })

  it('a recurring task advancing on completion keeps its follow-up (not a new task)', async () => {
    const id = await useTodoStore.getState().add('R')
    await useTodoStore.getState().update({
      ...mem(id), dueDate: day(2026, 10, 12), recurrenceRule: { type: 'weekly' },
    })
    const before = (await db.todos.get(id))!.nextFollowupAt
    await useTodoStore.getState().toggleComplete(id)
    const row = (await db.todos.get(id))!
    expect(row.dueDate).toEqual(day(2026, 10, 19))
    expect(row.nextFollowupAt).toEqual(before)
    expect(await db.todos.count()).toBe(1)
  })
})

describe('markFollowedUp', () => {
  it('sets last = now and next = today + default on every task; store and DB agree', async () => {
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().add('B')
    // A clock tick between the optimistic update and the DB write must not
    // produce two different timestamps.
    const orig = todoRepository.bulkUpdate.bind(todoRepository)
    vi.spyOn(todoRepository, 'bulkUpdate').mockImplementation(async (m) => {
      vi.setSystemTime(Date.now() + 5)
      return orig(m)
    })
    await useTodoStore.getState().markFollowedUp([a, b])
    for (const id of [a, b]) {
      const row = (await db.todos.get(id))!
      expect(row.lastFollowupAt).toEqual(NOW)
      expect(row.nextFollowupAt).toEqual(day(2026, 11, 10))
      expect(mem(id).lastFollowupAt?.getTime()).toBe(row.lastFollowupAt?.getTime())
      expect(mem(id).nextFollowupAt?.getTime()).toBe(row.nextFollowupAt?.getTime())
    }
  })

  it('is one undo step with the snackbar; undo restores the previous values in store and DB', async () => {
    const a = await useTodoStore.getState().add('A')
    await useTodoStore.getState().update({ ...mem(a), nextFollowupAt: undefined })
    useUndoStore.getState().clear()
    await useTodoStore.getState().markFollowedUp([a])
    const undo = useUndoStore.getState()
    expect(undo.undoStack).toHaveLength(1)
    expect(undo.undoStack[0]!.description).toBe('Followed up · next follow-up Tue 10 Nov')
    expect(undo.snackbar?.description).toBe('Followed up · next follow-up Tue 10 Nov')
    await useUndoStore.getState().undo()
    const row = (await db.todos.get(a))!
    expect(row.lastFollowupAt).toBeUndefined()
    expect(row.nextFollowupAt).toBeUndefined()
    expect(mem(a).lastFollowupAt).toBeUndefined()
    expect(mem(a).nextFollowupAt).toBeUndefined()
  })
})

describe('bulkSetFollowup', () => {
  it('sets and clears nextFollowupAt on every task, undoably', async () => {
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().add('B')
    await useTodoStore.getState().bulkSetFollowup([a, b], null)
    expect((await db.todos.get(a))!.nextFollowupAt).toBeUndefined()
    expect((await db.todos.get(b))!.nextFollowupAt).toBeUndefined()
    expect(mem(b).nextFollowupAt).toBeUndefined()
    await useUndoStore.getState().undo()
    expect((await db.todos.get(a))!.nextFollowupAt).toEqual(day(2026, 11, 10))
    await useTodoStore.getState().bulkSetFollowup([a], day(2027, 1, 4))
    expect((await db.todos.get(a))!.nextFollowupAt).toEqual(day(2027, 1, 4))
  })
})
