import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { statusUpdateRepository } from '../../data/status-update-repository'
import { todoRepository } from '../../data'
import { markFollowedUpWithUpdate } from '../../services/mark-followed-up'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useTodoStore } from '../../stores/todo-store'
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
