import { create } from 'zustand'
import type { FloatingCalendar } from '../models'
import type { CalendarOrientation } from '../models/canvas-rails'
import { WEEK_OFFSET_MAX } from '../models/canvas-rails'
import { floatingCalendarRepository } from '../data'
import { undoable } from '../services/undoable'
import { mutate, optimistic, updateItemInList } from './store-helpers'

const DEFAULT_WIDTH = 380
const DEFAULT_HEIGHT = 320

interface FloatingCalendarState {
  calendars: FloatingCalendar[]
  loading: boolean
  error: string | null

  loadByCanvas: (canvasId: number) => Promise<void>
  /**
   * Create a floating calendar. `init` threads slot-level state from a
   * tab-drag → canvas pop-out (Phase 5 of float-dock) so the user's strip
   * orientation + week offset survive the dock → float transition. Omitting
   * `init` keeps the existing "blank floating calendar" behaviour used by the
   * context menu + kind-switch helpers.
   */
  add: (canvasId: number, x: number, y: number, init?: { orientation?: CalendarOrientation; weekOffset?: number }) => Promise<number>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  updateSize: (id: number, width: number, height: number) => Promise<void>
  updateOrientation: (id: number, orientation: CalendarOrientation) => Promise<void>
  updateWeekOffset: (id: number, weekOffset: number) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const useFloatingCalendarStore = create<FloatingCalendarState>((set, get) => ({
  calendars: [],
  loading: false,
  error: null,

  async loadByCanvas(canvasId: number) {
    set({ loading: true, error: null })
    try {
      const rows = await floatingCalendarRepository.getByCanvas(canvasId)
      set({ calendars: rows })
    } catch (e) {
      console.error('Failed to load floating calendars:', e)
      set({ error: 'Failed to load floating calendars' })
    } finally {
      set({ loading: false })
    }
  },

  async add(canvasId, x, y, init) {
    return mutate(set, async () => {
      const id = await floatingCalendarRepository.insert({
        canvasId,
        x,
        y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        ...(init?.orientation != null ? { orientation: init.orientation } : {}),
        ...(init?.weekOffset != null ? { weekOffset: init.weekOffset } : {}),
      })
      const row = await floatingCalendarRepository.getById(id)
      if (row) set({ calendars: [...get().calendars, row] })
      return id
    }, 'Failed to add floating calendar')
  },

  async updatePosition(id, x, y) {
    const prev = get().calendars.find((c) => c.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => set({ calendars: updateItemInList(get().calendars, id, { x, y }) }),
      () => floatingCalendarRepository.updatePosition(id, x, y),
      () => set({ calendars: updateItemInList(get().calendars, id, { x: prev.x, y: prev.y }) }),
      'Failed to update floating calendar position',
    )
  },

  async updateSize(id, width, height) {
    const prev = get().calendars.find((c) => c.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => set({ calendars: updateItemInList(get().calendars, id, { width, height }) }),
      () => floatingCalendarRepository.update({ ...prev, width, height }),
      () => set({ calendars: updateItemInList(get().calendars, id, { width: prev.width, height: prev.height }) }),
      'Failed to update floating calendar size',
    )
  },

  async updateOrientation(id, orientation) {
    const prev = get().calendars.find((c) => c.id === id)
    if (!prev) return
    if (prev.orientation === orientation) return
    return optimistic(
      set,
      () => set({ calendars: updateItemInList(get().calendars, id, { orientation }) }),
      () => floatingCalendarRepository.update({ ...prev, orientation }),
      () => set({ calendars: updateItemInList(get().calendars, id, { orientation: prev.orientation }) }),
      'Failed to update floating calendar orientation',
    )
  },

  async updateWeekOffset(id, weekOffset) {
    const prev = get().calendars.find((c) => c.id === id)
    if (!prev) return
    if (!Number.isFinite(weekOffset)) return
    const clamped = Math.max(-WEEK_OFFSET_MAX, Math.min(WEEK_OFFSET_MAX, Math.trunc(weekOffset)))
    if (prev.weekOffset === clamped) return
    return optimistic(
      set,
      () => set({ calendars: updateItemInList(get().calendars, id, { weekOffset: clamped }) }),
      () => floatingCalendarRepository.update({ ...prev, weekOffset: clamped }),
      () => set({ calendars: updateItemInList(get().calendars, id, { weekOffset: prev.weekOffset }) }),
      'Failed to update floating calendar week offset',
    )
  },

  async remove(id) {
    return mutate(set, async () => {
      const row = get().calendars.find((c) => c.id === id)
      await floatingCalendarRepository.remove(id)
      set({ calendars: get().calendars.filter((c) => c.id !== id) })
      if (row) {
        undoable(
          'Delete floating calendar',
          () => get().remove(id),
          async () => {
            await floatingCalendarRepository.insert(row)
            set({ calendars: [...get().calendars, row] })
          },
          true,
        )
      }
    }, 'Failed to delete floating calendar')
  },
}))
