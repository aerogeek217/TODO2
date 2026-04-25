import { create } from 'zustand'
import { canvasRepository } from '../data'

interface CanvasState {
  selectedCanvasId: number | null
  loading: boolean
  error: string | null

  ensureDefault: () => Promise<void>
}

export const useCanvasStore = create<CanvasState>((set) => ({
  selectedCanvasId: null,
  loading: false,
  error: null,

  async ensureDefault() {
    set({ loading: true, error: null })
    try {
      const canvases = await canvasRepository.getAll()
      if (canvases.length === 0) {
        const id = await canvasRepository.insert({
          name: 'My Canvas',
          sortOrder: 0,
          createdAt: new Date(),
        })
        set({ selectedCanvasId: id })
      } else {
        const first = canvases[0]
        if (first?.id != null) {
          set({ selectedCanvasId: first.id })
        }
      }
    } catch (e) {
      console.error('Failed to load canvas:', e)
      set({ error: 'Failed to load canvas' })
    } finally {
      set({ loading: false })
    }
  },
}))
