import { create } from 'zustand'
import type { FloatingTaskboard } from '../models'
import { floatingTaskboardRepository } from '../data'
import { undoable } from '../services/undoable'
import { mutate, optimistic, updateItemInList } from './store-helpers'

/**
 * Placement-only widgets that render a specific Taskboard on a canvas.
 * Parallels `useFloatingCalendarStore` / `useFloatingNoteStore`: entries
 * live on the referenced `Taskboard` row; this store only tracks x/y/w/h
 * + collapse.
 */

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 400

interface FloatingTaskboardState {
  taskboards: FloatingTaskboard[]
  loading: boolean
  error: string | null

  loadByCanvas: (canvasId: number) => Promise<void>
  add: (canvasId: number, x: number, y: number) => Promise<number>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  updateSize: (id: number, width: number, height: number) => Promise<void>
  setCollapsed: (id: number, collapsed: boolean) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const useFloatingTaskboardStore = create<FloatingTaskboardState>((set, get) => ({
  taskboards: [],
  loading: false,
  error: null,

  async loadByCanvas(canvasId: number) {
    set({ loading: true, error: null })
    try {
      const rows = await floatingTaskboardRepository.getByCanvas(canvasId)
      set({ taskboards: rows })
    } catch (e) {
      console.error('Failed to load floating taskboards:', e)
      set({ error: 'Failed to load floating taskboards' })
    } finally {
      set({ loading: false })
    }
  },

  async add(canvasId, x, y) {
    return mutate(set, async () => {
      const id = await floatingTaskboardRepository.insert({
        canvasId,
        x,
        y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      })
      const row = await floatingTaskboardRepository.getById(id)
      if (row) set({ taskboards: [...get().taskboards, row] })
      return id
    }, 'Failed to add floating taskboard')
  },

  async updatePosition(id, x, y) {
    const prev = get().taskboards.find((n) => n.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => set({ taskboards: updateItemInList(get().taskboards, id, { x, y }) }),
      () => floatingTaskboardRepository.updatePosition(id, x, y),
      () => set({ taskboards: updateItemInList(get().taskboards, id, { x: prev.x, y: prev.y }) }),
      'Failed to update floating taskboard position',
    )
  },

  async updateSize(id, width, height) {
    const prev = get().taskboards.find((n) => n.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => set({ taskboards: updateItemInList(get().taskboards, id, { width, height }) }),
      () => floatingTaskboardRepository.update({ ...prev, width, height }),
      () => set({ taskboards: updateItemInList(get().taskboards, id, { width: prev.width, height: prev.height }) }),
      'Failed to update floating taskboard size',
    )
  },

  async setCollapsed(id, collapsed) {
    const prev = get().taskboards.find((n) => n.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => set({ taskboards: updateItemInList(get().taskboards, id, { collapsed }) }),
      () => floatingTaskboardRepository.update({ ...prev, collapsed }),
      () => set({ taskboards: updateItemInList(get().taskboards, id, { collapsed: prev.collapsed }) }),
      'Failed to update floating taskboard',
    )
  },

  async remove(id) {
    return mutate(set, async () => {
      const row = get().taskboards.find((n) => n.id === id)
      await floatingTaskboardRepository.remove(id)
      set({ taskboards: get().taskboards.filter((n) => n.id !== id) })
      if (row) {
        undoable(
          'Close floating taskboard',
          () => get().remove(id),
          async () => {
            await floatingTaskboardRepository.insert(row)
            set({ taskboards: [...get().taskboards, row] })
          },
          true,
        )
      }
    }, 'Failed to close floating taskboard')
  },
}))
