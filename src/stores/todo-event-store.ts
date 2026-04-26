import { create } from 'zustand'
import type { TodoEvent, TodoEventType } from '../models'
import { todoEventRepository } from '../data/todo-event-repository'

/**
 * Lazy-loaded cache of `todoEvents` rows for stat widgets.
 *
 * Widgets call `loadInRange(from, to, types?)` on mount; the store keeps the
 * last requested range so `invalidate()` can re-pull after a mutation. Widgets
 * subscribe to `useTodoStore.todos` and trigger `loadInRange` (or `invalidate`)
 * when the array reference changes — the store does NOT subscribe to the todo
 * store itself to avoid cross-store coupling.
 *
 * For the discipline scoreboard the typical range is ~12 weeks; for the snooze
 * graveyard a much wider range (or `loadAll`) is appropriate. Multiple widgets
 * sharing the store will compete on `range` — the most-recent caller wins.
 */
interface TodoEventState {
  events: TodoEvent[]
  range: { from: number; to: number; types: readonly TodoEventType[] | null } | null
  loading: boolean
  error: string | null

  loadInRange: (from: Date, to: Date, types?: readonly TodoEventType[]) => Promise<void>
  loadAll: () => Promise<void>
  /** Re-pull the most recent range/all read; no-op if neither has been requested. */
  invalidate: () => Promise<void>
}

export const useTodoEventStore = create<TodoEventState>((set, get) => ({
  events: [],
  range: null,
  loading: false,
  error: null,

  async loadInRange(from, to, types) {
    set({ loading: true, error: null })
    try {
      const events = await todoEventRepository.inRange(from, to, types)
      set({
        events,
        range: { from: from.getTime(), to: to.getTime(), types: types ?? null },
        loading: false,
      })
    } catch (e) {
      console.error('Failed to load todoEvents in range:', e)
      set({ error: 'Failed to load todoEvents', loading: false })
    }
  },

  async loadAll() {
    set({ loading: true, error: null })
    try {
      const events = await todoEventRepository.getAll()
      set({ events, range: null, loading: false })
    } catch (e) {
      console.error('Failed to load all todoEvents:', e)
      set({ error: 'Failed to load todoEvents', loading: false })
    }
  },

  async invalidate() {
    const { range } = get()
    if (range) {
      await get().loadInRange(
        new Date(range.from),
        new Date(range.to),
        range.types ?? undefined,
      )
    } else if (get().events.length > 0) {
      await get().loadAll()
    }
  },
}))
