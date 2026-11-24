import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { TodoEvent } from '../../models'
import { useWeekLoad } from '../../hooks/use-week-load'
import { useFilterStore } from '../../stores/filter-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useTodoStore } from '../../stores/todo-store'
import { trendEventsKey, useTrendEventsStore } from '../../stores/trend-events-store'
import { eventsWindowRead } from '../../utils/trend-window'
import { makeTodo } from '../helpers'

/**
 * `useWeekLoad`: every task, whatever the screen filter; its events from
 * the `week-load` window (this week's start, 8 weeks back); `null` until
 * they are read.
 */

const NOW = new Date(2026, 10, 25, 14, 0) // Wed
const TODAY = new Date(2026, 10, 25)
const OLD = new Date(2026, 8, 1)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  useSettingsStore.setState({ weekStartsOn: 1, planLogSince: OLD, historyLogSince: OLD })
  useStatusUpdateStore.setState({ loaded: true, byTodo: new Map() })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Alpha', dueDate: new Date(2026, 10, 24), createdAt: OLD, modifiedAt: OLD }),
      makeTodo({ id: 2, title: 'Beta', dueDate: new Date(2026, 10, 27), createdAt: OLD, modifiedAt: OLD }),
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function withEvents(events: TodoEvent[]): void {
  useTrendEventsStore.setState({
    entries: new Map([[trendEventsKey('week-load', TODAY, 1), { events, stale: false, loading: false }]]),
    generation: 0,
  })
}

describe('useWeekLoad', () => {
  it('reads from this week’s start 8 weeks back, with the planned, follow-up and state events', () => {
    const read = eventsWindowRead('week-load', TODAY, 1)
    expect(read.start).toEqual(new Date(2026, 8, 28))
    for (const type of ['created', 'completed', 'reopened', 'deadline', 'followup', 'followedUp', 'planned'] as const) {
      expect(read.types).toContain(type)
    }
  })

  it('counts every task, whatever the screen filter; null before the events are read', () => {
    useTrendEventsStore.setState({ entries: new Map([[trendEventsKey('week-load', TODAY, 1), { events: null, stale: false, loading: true }]]), generation: 0 })
    const { result } = renderHook(() => useWeekLoad())
    expect(result.current).toBeNull()

    act(() => withEvents([]))
    act(() => useFilterStore.getState().setSearchText('Alpha'))
    const thisWeek = result.current?.weeks.find((w) => w.offset === 0)
    expect(thisWeek?.totals).toMatchObject({ load: 2, late: 1, ahead: 1 })
  })
})
