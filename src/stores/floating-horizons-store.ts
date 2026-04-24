import { create } from 'zustand'
import type { FloatingHorizons } from '../models'
import { floatingHorizonsRepository } from '../data'
import { undoable } from '../services/undoable'
import { mutate, optimistic, updateItemInList } from './store-helpers'

/**
 * Placement-only widgets that render the global horizon ribbon + selected
 * horizon's list. Parallels `useFloatingCalendarStore` /
 * `useFloatingTaskboardStore`: ribbon state lives in settings; this store
 * only tracks x/y/w/h + collapse.
 */

const DEFAULT_WIDTH = 520
const DEFAULT_HEIGHT = 360

interface FloatingHorizonsState {
  horizons: FloatingHorizons[]
  loading: boolean
  error: string | null

  loadByCanvas: (canvasId: number) => Promise<void>
  add: (canvasId: number, x: number, y: number) => Promise<number>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  updateSize: (id: number, width: number, height: number) => Promise<void>
  setCollapsed: (id: number, collapsed: boolean) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const useFloatingHorizonsStore = create<FloatingHorizonsState>((set, get) => ({
  horizons: [],
  loading: false,
  error: null,

  async loadByCanvas(canvasId: number) {
    set({ loading: true, error: null })
    try {
      const rows = await floatingHorizonsRepository.getByCanvas(canvasId)
      set({ horizons: rows })
    } catch (e) {
      console.error('Failed to load floating horizons:', e)
      set({ error: 'Failed to load floating horizons' })
    } finally {
      set({ loading: false })
    }
  },

  async add(canvasId, x, y) {
    return mutate(set, async () => {
      const id = await floatingHorizonsRepository.insert({
        canvasId,
        x,
        y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      })
      const row = await floatingHorizonsRepository.getById(id)
      if (row) set({ horizons: [...get().horizons, row] })
      return id
    }, 'Failed to add floating horizons')
  },

  async updatePosition(id, x, y) {
    const prev = get().horizons.find((n) => n.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => set({ horizons: updateItemInList(get().horizons, id, { x, y }) }),
      () => floatingHorizonsRepository.updatePosition(id, x, y),
      () => set({ horizons: updateItemInList(get().horizons, id, { x: prev.x, y: prev.y }) }),
      'Failed to update floating horizons position',
    )
  },

  async updateSize(id, width, height) {
    const prev = get().horizons.find((n) => n.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => set({ horizons: updateItemInList(get().horizons, id, { width, height }) }),
      () => floatingHorizonsRepository.update({ ...prev, width, height }),
      () => set({ horizons: updateItemInList(get().horizons, id, { width: prev.width, height: prev.height }) }),
      'Failed to update floating horizons size',
    )
  },

  async setCollapsed(id, collapsed) {
    const prev = get().horizons.find((n) => n.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => set({ horizons: updateItemInList(get().horizons, id, { collapsed }) }),
      () => floatingHorizonsRepository.update({ ...prev, collapsed }),
      () => set({ horizons: updateItemInList(get().horizons, id, { collapsed: prev.collapsed }) }),
      'Failed to update floating horizons',
    )
  },

  async remove(id) {
    return mutate(set, async () => {
      const row = get().horizons.find((n) => n.id === id)
      await floatingHorizonsRepository.remove(id)
      set({ horizons: get().horizons.filter((n) => n.id !== id) })
      if (row) {
        undoable(
          'Close floating horizons',
          () => get().remove(id),
          async () => {
            await floatingHorizonsRepository.insert(row)
            set({ horizons: [...get().horizons, row] })
          },
          true,
        )
      }
    }, 'Failed to close floating horizons')
  },
}))
