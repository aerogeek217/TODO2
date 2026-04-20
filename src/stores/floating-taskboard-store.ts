import { create } from 'zustand'
import type { FloatingTaskboard } from '../models'
import { floatingTaskboardRepository } from '../data'
import { undoable } from '../services/undoable'
import { mutate, optimistic } from './store-helpers'

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
  add: (canvasId: number, taskboardId: number, x: number, y: number) => Promise<number>
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

  async add(canvasId, taskboardId, x, y) {
    return mutate(set, async () => {
      const id = await floatingTaskboardRepository.insert({
        canvasId,
        taskboardId,
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
    const prevX = prev.x
    const prevY = prev.y
    return optimistic(
      set,
      () => set({ taskboards: get().taskboards.map((n) => (n.id === id ? { ...n, x, y } : n)) }),
      () => floatingTaskboardRepository.updatePosition(id, x, y),
      () => set({ taskboards: get().taskboards.map((n) => (n.id === id ? { ...n, x: prevX, y: prevY } : n)) }),
      'Failed to update floating taskboard position',
    )
  },

  async updateSize(id, width, height) {
    const prev = get().taskboards.find((n) => n.id === id)
    if (!prev) return
    const next: FloatingTaskboard = { ...prev, width, height }
    return optimistic(
      set,
      () => set({ taskboards: get().taskboards.map((n) => (n.id === id ? next : n)) }),
      () => floatingTaskboardRepository.update(next),
      () => set({ taskboards: get().taskboards.map((n) => (n.id === id ? prev : n)) }),
      'Failed to update floating taskboard size',
    )
  },

  async setCollapsed(id, collapsed) {
    const prev = get().taskboards.find((n) => n.id === id)
    if (!prev) return
    const next: FloatingTaskboard = { ...prev, collapsed }
    return optimistic(
      set,
      () => set({ taskboards: get().taskboards.map((n) => (n.id === id ? next : n)) }),
      () => floatingTaskboardRepository.update(next),
      () => set({ taskboards: get().taskboards.map((n) => (n.id === id ? prev : n)) }),
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
