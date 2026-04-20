import { create } from 'zustand'
import type { FloatingNote } from '../models'
import { floatingNoteRepository } from '../data'
import { undoable } from '../services/undoable'
import { mutate, optimistic, updateItemInList } from './store-helpers'

/**
 * Placement-only widgets that render the single global note on a canvas.
 * Parallels `useFloatingCalendarStore` / `useListInsetStore`: content lives
 * elsewhere (the `notes` global row); this store only tracks x/y/w/h.
 */

const DEFAULT_WIDTH = 240
const DEFAULT_HEIGHT = 200

interface FloatingNoteState {
  notes: FloatingNote[]
  loading: boolean
  error: string | null

  loadByCanvas: (canvasId: number) => Promise<void>
  add: (canvasId: number, x: number, y: number) => Promise<number>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  updateSize: (id: number, width: number, height: number) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const useFloatingNoteStore = create<FloatingNoteState>((set, get) => ({
  notes: [],
  loading: false,
  error: null,

  async loadByCanvas(canvasId: number) {
    set({ loading: true, error: null })
    try {
      const rows = await floatingNoteRepository.getByCanvas(canvasId)
      set({ notes: rows })
    } catch (e) {
      console.error('Failed to load floating notes:', e)
      set({ error: 'Failed to load floating notes' })
    } finally {
      set({ loading: false })
    }
  },

  async add(canvasId, x, y) {
    return mutate(set, async () => {
      const id = await floatingNoteRepository.insert({
        canvasId,
        x,
        y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      })
      const row = await floatingNoteRepository.getById(id)
      if (row) set({ notes: [...get().notes, row] })
      return id
    }, 'Failed to add floating note')
  },

  async updatePosition(id, x, y) {
    const prev = get().notes.find((n) => n.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => set({ notes: updateItemInList(get().notes, id, { x, y }) }),
      () => floatingNoteRepository.updatePosition(id, x, y),
      () => set({ notes: updateItemInList(get().notes, id, { x: prev.x, y: prev.y }) }),
      'Failed to update floating note position',
    )
  },

  async updateSize(id, width, height) {
    const prev = get().notes.find((n) => n.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => set({ notes: updateItemInList(get().notes, id, { width, height }) }),
      () => floatingNoteRepository.update({ ...prev, width, height }),
      () => set({ notes: updateItemInList(get().notes, id, { width: prev.width, height: prev.height }) }),
      'Failed to update floating note size',
    )
  },

  async remove(id) {
    return mutate(set, async () => {
      const row = get().notes.find((n) => n.id === id)
      await floatingNoteRepository.remove(id)
      set({ notes: get().notes.filter((n) => n.id !== id) })
      if (row) {
        undoable(
          'Close floating note',
          () => get().remove(id),
          async () => {
            await floatingNoteRepository.insert(row)
            set({ notes: [...get().notes, row] })
          },
          true,
        )
      }
    }, 'Failed to close floating note')
  },
}))
