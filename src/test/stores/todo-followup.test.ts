import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { autoNextFollowup, newTaskDefaultFollowup, useSettingsStore } from '../../stores/settings-store'
import { DEFAULT_FOLLOWUP_INTERVAL } from '../../utils/followup'

// Sat 10 Oct 2026, 15:30 local.
const NOW = new Date(2026, 9, 10, 15, 30)
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState({ todos: [], todosVersion: 0 })
  useUndoStore.getState().clear()
  useSettingsStore.setState({ followupDefaultInterval: DEFAULT_FOLLOWUP_INTERVAL, autoFollowup: true, defaultStatusId: null })
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
    await useTodoStore.getState().update(id, { nextFollowupAt: day(2026, 12, 1), lastFollowupAt: day(2026, 10, 1) })
    const copy = (await useTodoStore.getState().duplicate(id))!
    const row = (await db.todos.get(copy))!
    expect(row.nextFollowupAt).toEqual(day(2026, 12, 1))
    expect(row.lastFollowupAt).toBeUndefined()
  })

  it('a recurring task advancing on completion keeps its follow-up (not a new task)', async () => {
    const id = await useTodoStore.getState().add('R')
    await useTodoStore.getState().update(id, { dueDate: day(2026, 10, 12), recurrenceRule: { type: 'weekly' } })
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
    await useTodoStore.getState().update(a, { nextFollowupAt: undefined })
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

  it('with the automatic next follow-up off, clears the next follow-up (last = now); undo brings it back', async () => {
    const a = await useTodoStore.getState().add('A')
    await useTodoStore.getState().update(a, { nextFollowupAt: day(2026, 10, 13) })
    useSettingsStore.setState({ autoFollowup: false })
    useUndoStore.getState().clear()
    await useTodoStore.getState().markFollowedUp([a])
    const row = (await db.todos.get(a))!
    expect(row.lastFollowupAt).toEqual(NOW)
    expect(row.nextFollowupAt).toBeUndefined()
    expect(mem(a).nextFollowupAt).toBeUndefined()
    expect(useUndoStore.getState().undoStack[0]!.description).toBe('Followed up · no next follow-up')
    await useUndoStore.getState().undo()
    expect((await db.todos.get(a))!.nextFollowupAt).toEqual(day(2026, 10, 13))
    expect(mem(a).lastFollowupAt).toBeUndefined()
  })

  it('a given next follow-up wins over the rule (a date, or null = none), and redo sets the same one', async () => {
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().add('B')
    useUndoStore.getState().clear()
    await useTodoStore.getState().markFollowedUp([a], { next: day(2026, 10, 24) })
    expect((await db.todos.get(a))!).toMatchObject({ lastFollowupAt: NOW, nextFollowupAt: day(2026, 10, 24) })
    expect(useUndoStore.getState().undoStack[0]!.description).toBe('Followed up · next follow-up Sat 24 Oct')
    await useTodoStore.getState().markFollowedUp([b], { next: null })
    expect((await db.todos.get(b))!.nextFollowupAt).toBeUndefined()
    expect((await db.todos.get(b))!.lastFollowupAt).toEqual(NOW)

    await useUndoStore.getState().undo()
    await useUndoStore.getState().undo()
    expect((await db.todos.get(a))!.nextFollowupAt).toEqual(day(2026, 11, 10))
    vi.setSystemTime(new Date(2026, 9, 12, 8, 0))
    await useUndoStore.getState().redo()
    expect((await db.todos.get(a))!).toMatchObject({ lastFollowupAt: new Date(2026, 9, 12, 8, 0), nextFollowupAt: day(2026, 10, 24) })
  })

  it('names its undo step with a description and a detail line when given', async () => {
    const a = await useTodoStore.getState().add('A')
    useUndoStore.getState().clear()
    await useTodoStore.getState().markFollowedUp([a], { description: 'Sent a check-in', detail: 'to Ann' })
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Sent a check-in', detail: 'to Ann' })
  })
})

describe('autoNextFollowup — the one rule for the automatic next follow-up', () => {
  it('on: the day `now` falls on + the interval; off: none — and new tasks follow it', async () => {
    expect(autoNextFollowup(NOW)).toEqual(day(2026, 11, 10))
    expect(autoNextFollowup(NOW, { autoFollowup: true, followupDefaultInterval: { count: 2, unit: 'w' } })).toEqual(day(2026, 10, 24))
    expect(autoNextFollowup(NOW, { autoFollowup: false, followupDefaultInterval: { count: 2, unit: 'w' } })).toBeNull()
    expect(newTaskDefaultFollowup(NOW)).toEqual(day(2026, 11, 10))
    useSettingsStore.setState({ autoFollowup: false })
    expect(autoNextFollowup(NOW)).toBeNull()
    expect(newTaskDefaultFollowup(NOW)).toBeUndefined()
    const id = await useTodoStore.getState().add('Off')
    expect((await db.todos.get(id))!.nextFollowupAt).toBeUndefined()
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

describe('bulkSetLastFollowup', () => {
  it('sets and clears lastFollowupAt on every task, undoably', async () => {
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().add('B')
    await useTodoStore.getState().bulkSetLastFollowup([a, b], day(2026, 9, 13))
    expect((await db.todos.get(a))!.lastFollowupAt).toEqual(day(2026, 9, 13))
    expect(mem(b).lastFollowupAt).toEqual(day(2026, 9, 13))
    await useUndoStore.getState().undo()
    expect((await db.todos.get(b))!.lastFollowupAt).toBeUndefined()
    await useTodoStore.getState().bulkSetLastFollowup([a], day(2026, 9, 1))
    await useTodoStore.getState().bulkSetLastFollowup([a], null)
    expect((await db.todos.get(a))!.lastFollowupAt).toBeUndefined()
  })
})
