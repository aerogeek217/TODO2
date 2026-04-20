import { create } from 'zustand'
import type { FloatingCalendar } from '../models'
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
  add: (canvasId: number, x: number, y: number) => Promise<number>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  updateSize: (id: number, width: number, height: number) => Promise<void>
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

  async add(canvasId, x, y) {
    return mutate(set, async () => {
      const id = await floatingCalendarRepository.insert({
        canvasId,
        x,
        y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
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
