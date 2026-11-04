import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { statusUpdateRepository } from '../../data/status-update-repository'
import { todoRepository } from '../../data'
import { addStatusUpdate, markFollowedUpWithUpdate } from '../../services/mark-followed-up'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useTodoStore } from '../../stores/todo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUndoStore } from '../../stores/undo-store'
import { startOfDay, startOfToday } from '../../utils/date'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

async function tasks(...titles: string[]): Promise<number[]> {
  const ids: number[] = []
  for (const t of titles) ids.push(await useTodoStore.getState().add(t))
  useUndoStore.getState().clear()
  return ids
}

const followedUpToday = (id: number) => {
  const last = useTodoStore.getState().todos.find((t) => t.id === id)?.lastFollowupAt
  return !!last && startOfDay(last).getTime() === startOfToday().getTime()
}

describe('markFollowedUpWithUpdate', () => {
  it('no text: exactly Mark followed up — no entry, its own undo step', async () => {
    const [id] = await tasks('Quote') as [number]
    await markFollowedUpWithUpdate([id], {}, '   ')
    expect(followedUpToday(id)).toBe(true)
    expect(await db.statusUpdates.count()).toBe(0)
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual([expect.stringMatching(/^Followed up/)])
  })

  it('with text: every task followed up and given the entry (today, followedUp) — one undo step takes back both', async () => {
    const ids = await tasks('Quote', 'Contract')
    await markFollowedUpWithUpdate(ids, { next: null }, '  Waiting on legal ')
    for (const id of ids) {
      expect(followedUpToday(id)).toBe(true)
      expect(useStatusUpdateStore.getState().byTodo.get(id)?.map((u) => [u.date, u.text, u.followedUp]))
        .toEqual([[startOfToday(), 'Waiting on legal', true]])
    }
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Followed up 2 tasks · status update added'])

    await useUndoStore.getState().undo()
    expect(ids.some(followedUpToday)).toBe(false)
    expect(await db.statusUpdates.count()).toBe(0)
    expect(useStatusUpdateStore.getState().byTodo.size).toBe(0)

    await useUndoStore.getState().redo()
    expect(ids.every(followedUpToday)).toBe(true)
    expect(await db.statusUpdates.count()).toBe(2)
  })

  it('the entry not written: nothing is followed up, no undo step', async () => {
    const [id] = await tasks('Quote') as [number]
    vi.spyOn(statusUpdateRepository, 'addMany').mockRejectedValueOnce(new Error('disk full'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await markFollowedUpWithUpdate([id], {}, 'Waiting')
    expect(followedUpToday(id)).toBe(false)
    expect(useUndoStore.getState().undoStack).toEqual([])
    vi.restoreAllMocks()
  })

  it('the follow-up not written: the entry is taken back and a notice says nothing changed', async () => {
    const [id] = await tasks('Quote') as [number]
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValueOnce(new Error('disk full'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await markFollowedUpWithUpdate([id], {}, 'Waiting')
    expect(await db.statusUpdates.count()).toBe(0)
    expect(useUndoStore.getState().undoStack).toEqual([])
    expect(useUndoStore.getState().snackbar?.description).toBe('Couldn’t mark the tasks followed up. Nothing changed.')
    vi.restoreAllMocks()
  })
})

describe('addStatusUpdate: entering a status counts as following up on its day', () => {
  const NOW = new Date(2026, 9, 10, 15, 30)
  const task = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)
  const entries = (id: number) => useStatusUpdateStore.getState().byTodo.get(id)?.map((u) => [u.date, u.text, u.followedUp])

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    useSettingsStore.setState({ autoFollowup: true, followupDefaultInterval: { count: 1, unit: 'm' } })
  })
  afterEach(() => { vi.useRealTimers() })

  async function taskWith(fields: { last?: Date; next?: Date }): Promise<number> {
    const [id] = await tasks('Quote') as [number]
    await useTodoStore.getState().update(id, { lastFollowupAt: fields.last, nextFollowupAt: fields.next })
    useUndoStore.getState().clear()
    return id
  }

  it('dated today on a task never followed up: Mark followed up, now, with the rule — one undo step', async () => {
    const id = await taskWith({ next: new Date(2026, 9, 5) })
    await addStatusUpdate(id, { date: NOW, text: 'Sent it' })
    expect(task(id)?.lastFollowupAt).toEqual(NOW)
    expect(task(id)?.nextFollowupAt).toEqual(new Date(2026, 10, 10))
    expect(entries(id)).toEqual([[new Date(2026, 9, 10), 'Sent it', true]])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Followed up · status update added'])

    await useUndoStore.getState().undo()
    expect(task(id)?.lastFollowupAt).toBeUndefined()
    expect(task(id)?.nextFollowupAt).toEqual(new Date(2026, 9, 5))
    expect(entries(id)).toBeUndefined()
  })

  it('a later next follow-up is kept', async () => {
    const id = await taskWith({ next: new Date(2026, 9, 20) })
    await addStatusUpdate(id, { date: NOW, text: 'Sent it' })
    expect(task(id)?.lastFollowupAt).toEqual(NOW)
    expect(task(id)?.nextFollowupAt).toEqual(new Date(2026, 9, 20))
  })

  it('dated back, newer than the last follow-up: that day, the rule counted from it', async () => {
    const id = await taskWith({ last: new Date(2026, 8, 1), next: new Date(2026, 9, 2) })
    await addStatusUpdate(id, { date: new Date(2026, 9, 6), text: 'Called them' })
    expect(task(id)?.lastFollowupAt).toEqual(new Date(2026, 9, 6))
    // Oct 2 is before Oct 6: replaced by Oct 6 + the interval.
    expect(task(id)?.nextFollowupAt).toEqual(new Date(2026, 10, 6))
    expect(entries(id)).toEqual([[new Date(2026, 9, 6), 'Called them', true]])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Followed up 10/06 · status update added'])
  })

  it('dated back: a next follow-up after that day stays, even one already late', async () => {
    const id = await taskWith({ next: new Date(2026, 9, 8) })
    await addStatusUpdate(id, { date: new Date(2026, 9, 6), text: 'Called them' })
    expect(task(id)?.lastFollowupAt).toEqual(new Date(2026, 9, 6))
    expect(task(id)?.nextFollowupAt).toEqual(new Date(2026, 9, 8))
  })

  it('no later than the last follow-up (same day or older): only the entry, its own quiet step', async () => {
    const last = new Date(2026, 9, 6, 9, 0)
    for (const date of [new Date(2026, 9, 6), new Date(2026, 9, 1)]) {
      const id = await taskWith({ last, next: new Date(2026, 9, 2) })
      await addStatusUpdate(id, { date, text: 'Old news' })
      expect(task(id)?.lastFollowupAt).toEqual(last)
      expect(task(id)?.nextFollowupAt).toEqual(new Date(2026, 9, 2))
      expect(entries(id)).toEqual([[date, 'Old news', undefined]])
      expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Add status update'])
    }
  })

  it('a day after today is today', async () => {
    const id = await taskWith({})
    await addStatusUpdate(id, { date: new Date(2026, 9, 20), text: 'Sent it' })
    expect(task(id)?.lastFollowupAt).toEqual(NOW)
    expect(entries(id)).toEqual([[new Date(2026, 9, 10), 'Sent it', true]])
  })

  it('blank text writes nothing, and marks nothing', async () => {
    const id = await taskWith({})
    await addStatusUpdate(id, { date: NOW, text: '   ' })
    expect(task(id)?.lastFollowupAt).toBeUndefined()
    expect(await db.statusUpdates.count()).toBe(0)
    expect(useUndoStore.getState().undoStack).toEqual([])
  })
})
