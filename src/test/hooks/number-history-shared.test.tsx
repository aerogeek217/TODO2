import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../components/workspace/glance/GlanceWidget'
import { lensHidesFor, type LensHidden, type StatsBase } from '../../hooks/use-glance-data'
import type { GlanceTab, NumberTab } from '../../models/workspace-layout'
import { countReplayed, replayTasks } from '../../services/stats/filter-history'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { trendEventsKey, useTrendEventsStore } from '../../stores/trend-events-store'
import { matchesFilterWithLookups } from '../../utils/filter-match'
import { clearFilterStore, resetEntityStores } from '../helpers'
import { numberTab } from '../helpers/layout-builders'
import { ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, SAMPLE_EVENTS, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES, TAGS } from '../fixtures/glance-sample'

/**
 * A Number's 14-day line (cr34 M12, with G7): every Number on screen counts
 * from one replay of the tasks; a layout read again (equal filters, new
 * objects) computes nothing; after a task write the count is there at once
 * and the line a moment later, off the write's render (the user's answer
 * 13); and the lens switch's `−N` is matched once, not on every render.
 */

// Count the replays, the counts over them and the lens matches (the real ones run).
vi.mock('../../services/stats/filter-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/stats/filter-history')>()
  return { ...actual, replayTasks: vi.fn(actual.replayTasks), countReplayed: vi.fn(actual.countReplayed) }
})
vi.mock('../../utils/filter-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/filter-match')>()
  return { ...actual, matchesFilterWithLookups: vi.fn(actual.matchesFilterWithLookups) }
})

const TABS: NumberTab[] = [numberTab('a', 'open'), numberTab('b', 'overdue'), numberTab('c', 'focus'), numberTab('d', 'urgent')]

function show(tabs: readonly GlanceTab[]) {
  return render(<DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>)
}

const lines = () => [...document.querySelectorAll('[data-number] [data-sparkline] polyline')].map((el) => el.getAttribute('points'))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, weekStartsOn: 0 })
  useTodoStore.setState({ todos: SAMPLE_TASKS })
  usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: ASSIGNED_PEOPLE })
  useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  useTrendEventsStore.setState({
    entries: new Map([[trendEventsKey('history', SAMPLE_TODAY, 0), { events: SAMPLE_EVENTS, stale: false, loading: false }]]),
    generation: 0,
  })
  vi.mocked(replayTasks).mockClear()
  vi.mocked(countReplayed).mockClear()
  vi.mocked(matchesFilterWithLookups).mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Numbers share one history replay', () => {
  it('four Numbers replay the tasks once and count from it once each', () => {
    show(TABS)
    expect(lines()).toHaveLength(4)
    expect(vi.mocked(replayTasks)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(countReplayed)).toHaveBeenCalledTimes(4)
  })

  it('the same Numbers read again from the database (equal filters, new objects) compute nothing', () => {
    const first = show(TABS)
    const before = lines()
    first.unmount()
    vi.mocked(replayTasks).mockClear()
    vi.mocked(countReplayed).mockClear()
    // A layout switch reads the layout again: every tab and filter is a new object with the same content.
    show(structuredClone(TABS))
    expect(lines()).toEqual(before)
    expect(vi.mocked(replayTasks)).not.toHaveBeenCalled()
    expect(vi.mocked(countReplayed)).not.toHaveBeenCalled()
  })

  it('after a task write the counts are there at once; the lines follow a moment later, replayed once', async () => {
    show(TABS)
    const count = () => document.querySelector('[data-number="a"] [data-testid="number-count"]')?.textContent
    const before = lines()
    const open = Number(count())
    vi.mocked(replayTasks).mockClear()
    vi.mocked(countReplayed).mockClear()
    const victim = SAMPLE_TASKS.find((t) => !t.isCompleted)!
    act(() => {
      useTodoStore.setState({ todos: SAMPLE_TASKS.map((t) => (t.id === victim.id ? { ...t, isCompleted: true, completedAt: new Date(2026, 9, 10, 9) } : t)) })
    })
    // The write's own render: the count has moved, nothing was replayed, the lines are the ones it had.
    expect(Number(count())).toBe(open - 1)
    expect(vi.mocked(replayTasks)).not.toHaveBeenCalled()
    expect(lines()).toEqual(before)
    // A moment later: one replay for the four of them, and the Open line's last point has moved.
    await waitFor(() => expect(vi.mocked(replayTasks)).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(lines()[0]).not.toBe(before[0]))
    expect(vi.mocked(countReplayed)).toHaveBeenCalledTimes(4)
  })
})

describe('the lens switch’s −N (cr34 G7)', () => {
  it('is matched once for the same hidden tasks and filter, however often it is asked', () => {
    const hidden = SAMPLE_TASKS.slice(0, 6)
    const base = {
      ctx: { today: SAMPLE_TODAY, weekStartsOn: 0, urgentRange: 3, assignedPeopleMap: ASSIGNED_PEOPLE, assignedTagsMap: ASSIGNED_TAGS, statuses: STATUSES },
      lookups: { assignedPeopleMap: ASSIGNED_PEOPLE, assignedTagsMap: ASSIGNED_TAGS },
      markerSettings: { urgentRange: 3, weekStartsOn: 0 },
    } as unknown as StatsBase
    const info: LensHidden = { hidden, base }
    const filter = TABS[0]!.config.filter
    const first = lensHidesFor(info, filter)
    const calls = vi.mocked(matchesFilterWithLookups).mock.calls.length
    expect(calls).toBe(hidden.length)
    expect(lensHidesFor(info, filter)).toBe(first)
    expect(lensHidesFor(info, structuredClone(filter))).toBe(first)
    expect(vi.mocked(matchesFilterWithLookups)).toHaveBeenCalledTimes(calls)
    // Other hidden tasks: matched again.
    lensHidesFor({ hidden: hidden.slice(1), base }, filter)
    expect(vi.mocked(matchesFilterWithLookups)).toHaveBeenCalledTimes(calls + hidden.length - 1)
  })
})
