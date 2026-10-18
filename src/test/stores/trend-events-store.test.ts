import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { db } from '../../data/database'
import { todoEventRepository } from '../../data/todo-event-repository'
import { todoRepository } from '../../data/todo-repository'
import { trendEventsKey, useTrendEventsStore } from '../../stores/trend-events-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTrendEvents } from '../../hooks/use-trend-events'
import { refreshAllStores } from '../../stores/refresh-all'
import { makeTodo } from '../helpers'

const today = new Date(2026, 9, 10)

async function addEvent(todoId: number, type: 'created' | 'completed' | 'reopened' | 'status', at: Date) {
  await db.todoEvents.add({ todoId, type, fromValue: null, toValue: null, timestamp: at.toISOString() })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTrendEventsStore.setState(useTrendEventsStore.getInitialState(), true)
})

afterEach(() => {
  cleanup() // unmounts a hook a failed test left mounted (and its event hooks)
  vi.restoreAllMocks()
  vi.useRealTimers()
  // `refreshAllStores` and the hook test touch other stores: put every store
  // back (the shared-worker setup registers each one's reset).
  const resets = (globalThis as { __zustandStoreResets?: Set<() => void> }).__zustandStoreResets
  for (const reset of resets ?? []) reset()
})

describe('trend-events-store', () => {
  it('reads each (range, day) window once, with one query, and only the trend event types since its start', async () => {
    await addEvent(1, 'created', new Date(2026, 8, 26, 23)) // before the 14-day window
    await addEvent(1, 'completed', new Date(2026, 8, 27, 1))
    await addEvent(1, 'status', new Date(2026, 9, 1))
    const since = vi.spyOn(todoEventRepository, 'since')
    const { load } = useTrendEventsStore.getState()

    await load('14d', today, 0)
    await load('14d', today, 0)
    expect(since).toHaveBeenCalledTimes(1)
    const entry = useTrendEventsStore.getState().entries.get(trendEventsKey('14d', today, 0))
    expect(entry).toMatchObject({ stale: false, loading: false })
    expect(entry?.events?.map((e) => e.type)).toEqual(['completed'])

    await load('4w', today, 0)
    expect(since).toHaveBeenCalledTimes(2)
  })

  it('invalidate makes the next load read again, keeping the old events meanwhile', async () => {
    await addEvent(1, 'created', new Date(2026, 9, 5))
    const { load, invalidate } = useTrendEventsStore.getState()
    await load('14d', today, 0)
    await addEvent(2, 'created', new Date(2026, 9, 6))
    invalidate()
    const key = trendEventsKey('14d', today, 0)
    expect(useTrendEventsStore.getState().entries.get(key)).toMatchObject({ stale: true })
    expect(useTrendEventsStore.getState().entries.get(key)?.events).toHaveLength(1)
    await load('14d', today, 0)
    expect(useTrendEventsStore.getState().entries.get(key)?.events).toHaveLength(2)
  })

  it('a read that an invalidate overtakes lands stale', async () => {
    let release: () => void = () => {}
    vi.spyOn(todoEventRepository, 'since').mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve([]) }),
    )
    const { load, invalidate } = useTrendEventsStore.getState()
    const pending = load('14d', today, 0)
    invalidate()
    release()
    await pending
    expect(useTrendEventsStore.getState().entries.get(trendEventsKey('14d', today, 0))).toMatchObject({ stale: true, loading: false })
  })

  it('a new day drops the other days’ entries', async () => {
    const { load } = useTrendEventsStore.getState()
    await load('14d', today, 0)
    await load('14d', new Date(2026, 9, 11), 0)
    expect([...useTrendEventsStore.getState().entries.keys()]).toEqual([trendEventsKey('14d', new Date(2026, 9, 11), 0)])
  })

  it('a failed read logs, keeps what was shown and does not retry by itself', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(todoEventRepository, 'since').mockRejectedValueOnce(new Error('boom'))
    await useTrendEventsStore.getState().load('14d', today, 0)
    expect(error).toHaveBeenCalled()
    expect(useTrendEventsStore.getState().entries.get(trendEventsKey('14d', today, 0))).toEqual({ events: [], stale: false, loading: false })
  })

  it('an event write invalidates the cache with no dashboard mounted', async () => {
    await useTrendEventsStore.getState().load('14d', today, 0)
    expect(useTrendEventsStore.getState().entries.get(trendEventsKey('14d', today, 0))?.stale).toBe(false)
    await addEvent(1, 'completed', today)
    expect(useTrendEventsStore.getState().entries.get(trendEventsKey('14d', today, 0))?.stale).toBe(true)
  })

  it('refreshing every store after a restore invalidates the cache', async () => {
    await useTrendEventsStore.getState().load('14d', today, 0)
    await refreshAllStores()
    expect(useTrendEventsStore.getState().entries.get(trendEventsKey('14d', today, 0))?.stale).toBe(true)
  })
})

describe('useTrendEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 10, 12))
    useSettingsStore.setState({ weekStartsOn: 0 })
  })

  it('loads the window, then reads again after an event write', async () => {
    await addEvent(1, 'created', new Date(2026, 9, 5))
    const since = vi.spyOn(todoEventRepository, 'since')
    const { result, unmount } = renderHook(() => useTrendEvents('14d'))
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toHaveLength(1))

    await act(async () => {
      await todoRepository.insert(makeTodo({ id: undefined, createdAt: new Date(2026, 9, 10, 11) }))
    })
    await waitFor(() => expect(result.current).toHaveLength(2))
    expect(since).toHaveBeenCalledTimes(2)

    unmount()
    // Unmounted (the dashboard tab is not the active one): the store still
    // hears the write, so the next mount reads again instead of showing old bars.
    await todoRepository.insert(makeTodo({ id: undefined }))
    expect(useTrendEventsStore.getState().entries.get(trendEventsKey('14d', new Date(2026, 9, 10), 0))?.stale).toBe(true)
    const again = renderHook(() => useTrendEvents('14d'))
    await waitFor(() => expect(again.result.current).toHaveLength(3))
    again.unmount()
  })
})
