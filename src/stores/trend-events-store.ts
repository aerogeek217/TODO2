import { create } from 'zustand'
import { todoEventRepository } from '../data/todo-event-repository'
import type { TodoEvent } from '../models'
import { eventsWindowRead, type EventsWindow } from '../utils/trend-window'
import type { WeekStart } from '../utils/effective-date'
import { dayKey } from '../utils/date'

/**
 * The `todoEvents` Created vs completed and the Numbers' history read, cached
 * per (window, day): one indexed read of every created / completed /
 * reopened event (and, for a Number's history, every type a filter's
 * history reads — `trend-window.FILTER_HISTORY_EVENT_TYPES`) since the
 * window's first day — with, for a task the window first sees reopened, its
 * latest completion before it (`reopenedFirst`). `invalidate` (on any event write, or after a restore)
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
  load: (range: EventsWindow, today: Date, weekStartsOn: WeekStart) => Promise<void>
  invalidate: () => void
}

/** The cache key of a trend window (or a Number's history, `history`). */
export function trendEventsKey(range: EventsWindow, today: Date, weekStartsOn: WeekStart): string {
  return `${range}|${weekStartsOn}|${dayKey(today)}`
}

/**
 * The tasks whose first state event in `events` is a reopen: done when the
 * window starts, by a completion before it the window doesn't hold. Their
 * latest completion before the window is read too, so a replay knows when
 * they were done (a "completed within …" filter's past days) instead of
 * none, or a later completion.
 */
function reopenedFirst(events: readonly TodoEvent[]): number[] {
  const first = new Map<number, TodoEvent>()
  for (const e of events) {
    if (e.type !== 'created' && e.type !== 'completed' && e.type !== 'reopened') continue
    const kept = first.get(e.todoId)
    if (!kept || e.timestamp < kept.timestamp || (e.timestamp === kept.timestamp && (e.id ?? 0) < (kept.id ?? 0))) first.set(e.todoId, e)
  }
  return [...first.values()].filter((e) => e.type === 'reopened').map((e) => e.todoId)
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
        const read = eventsWindowRead(range, today, weekStartsOn)
        const inWindow = await todoEventRepository.since(read.start, read.types)
        const reopened = reopenedFirst(inWindow)
        events = reopened.length > 0 ? [...await todoEventRepository.lastCompletionsBefore(read.start, reopened), ...inWindow] : inWindow
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

// Every event write invalidates, whether or not a glance widget is mounted: a
// tab that isn't the active one is unmounted, and the next mount
// must not show bars cached before the write. (Dexie table hooks, so this
// lasts for the module's lifetime, like the database.)
const stopInvalidating = todoEventRepository.onChange(() => useTrendEventsStore.getState().invalidate())
if (import.meta.hot) import.meta.hot.dispose(stopInvalidating)
