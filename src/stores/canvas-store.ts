import { create } from 'zustand'
import { canvasRepository } from '../data'

interface CanvasState {
  selectedCanvasId: number | null
  loading: boolean

  ensureDefault: () => Promise<void>
}

export const useCanvasStore = create<CanvasState>((set) => ({
  selectedCanvasId: null,
  loading: false,

  async ensureDefault() {
    set({ loading: true })
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
        set({ selectedCanvasId: canvases[0].id! })
      }
    } finally {
      set({ loading: false })
    }
  },
}))
