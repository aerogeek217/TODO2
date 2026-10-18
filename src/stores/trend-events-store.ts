import { create } from 'zustand'
import { todoEventRepository } from '../data/todo-event-repository'
import type { TodoEvent } from '../models'
import type { DashboardTrendRange as TrendRange } from '../models/dashboard-config'
import { TREND_EVENT_TYPES, trendWindow } from '../utils/trend-window'
import type { WeekStart } from '../utils/effective-date'
import { dayKey } from '../utils/date'

/**
 * The `todoEvents` the dashboard trend reads, cached per (range, day): one
 * indexed read of every created / completed / reopened event since the
 * range's first day. `invalidate` (on any event write, or after a restore)
 * marks every entry stale; a stale entry keeps its events on show until the
 * re-read lands, so the chart never blanks.
 */
export interface TrendEventsEntry {
  /** The events read for the entry's window; `null` before the first read. */
  events: readonly TodoEvent[] | null
  /** Needs a (re-)read: never read, or invalidated since. */
  stale: boolean
  loading: boolean
}

interface TrendEventsState {
  entries: ReadonlyMap<string, TrendEventsEntry>
  /** Bumped by `invalidate`; a read that started before it lands stale. */
  generation: number
  /** Reads the window's events unless the entry is fresh or already loading. */
  load: (range: TrendRange, today: Date, weekStartsOn: WeekStart) => Promise<void>
  invalidate: () => void
}

/** The cache key of a trend window. */
export function trendEventsKey(range: TrendRange, today: Date, weekStartsOn: WeekStart): string {
  return `${range}|${weekStartsOn}|${dayKey(today)}`
}

export const useTrendEventsStore = create<TrendEventsState>((set, get) => {
  const setEntry = (key: string, entry: TrendEventsEntry, keepDay?: string) => {
    const next = new Map<string, TrendEventsEntry>()
    for (const [k, v] of get().entries) {
      // Entries for other days are never read again.
      if (keepDay == null || k.endsWith(`|${keepDay}`)) next.set(k, v)
    }
    next.set(key, entry)
    set({ entries: next })
  }

  return {
    entries: new Map(),
    generation: 0,

    async load(range, today, weekStartsOn) {
      const key = trendEventsKey(range, today, weekStartsOn)
      const current = get().entries.get(key)
      if (current && (current.loading || !current.stale)) return
      const generation = get().generation
      const previous = current?.events ?? null
      setEntry(key, { events: previous, stale: true, loading: true }, dayKey(today))
      let events: readonly TodoEvent[]
      try {
        const window = trendWindow(range, today, weekStartsOn)
        events = await todoEventRepository.since(window.start, TREND_EVENT_TYPES)
      } catch (e) {
        console.error('Failed to read task history:', e)
        // Keep what was shown; don't retry until the next change.
        setEntry(key, { events: previous ?? [], stale: false, loading: false })
        return
      }
      setEntry(key, { events, stale: get().generation !== generation, loading: false })
    },

    invalidate() {
      const { entries, generation } = get()
      const busy = [...entries.values()].some((e) => e.loading || !e.stale)
      if (!busy) return
      const next = new Map<string, TrendEventsEntry>()
      for (const [k, v] of entries) next.set(k, v.stale ? v : { ...v, stale: true })
      set({ entries: next, generation: generation + 1 })
    },
  }
})

// Every event write invalidates, whether or not a dashboard is mounted: a
// dashboard tab that isn't the active one is unmounted, and the next mount
// must not show bars cached before the write. (Dexie table hooks, so this
// lasts for the module's lifetime, like the database.)
const stopInvalidating = todoEventRepository.onChange(() => useTrendEventsStore.getState().invalidate())
if (import.meta.hot) import.meta.hot.dispose(stopInvalidating)
