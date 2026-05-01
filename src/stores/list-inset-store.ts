import { create } from 'zustand'
import type { ListInset } from '../models'
import { listInsetRepository } from '../data'
import { undoable } from '../services/undoable'
import { mutate, optimistic, updateItemInList } from './store-helpers'
import { clampCanvasPosition } from '../utils/canvas-bounds'
import { FLOAT_DEFAULT_RECTS } from '../services/float-default-rects'

interface ListInsetState {
  insets: ListInset[]
  loading: boolean
  error: string | null

  loadByCanvas: (canvasId: number) => Promise<void>
  add: (listDefinitionId: number, canvasId: number, x: number, y: number) => Promise<number>
  update: (inset: ListInset) => Promise<void>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const useListInsetStore = create<ListInsetState>((set, get) => ({
  insets: [],
  loading: false,
  error: null,

  async loadByCanvas(canvasId: number) {
    set({ loading: true, error: null })
    try {
      const insets = await listInsetRepository.getByCanvas(canvasId)
      set({ insets })
    } catch (e) {
      console.error('Failed to load list insets:', e)
      set({ error: 'Failed to load list insets' })
    } finally {
      set({ loading: false })
    }
  },

  async add(listDefinitionId: number, canvasId: number, x: number, y: number) {
    return mutate(set, async () => {
      const clamped = clampCanvasPosition(x, y)
      const id = await listInsetRepository.insert({
        listDefinitionId,
        canvasId,
        x: clamped.x,
        y: clamped.y,
        width: FLOAT_DEFAULT_RECTS.lens.width,
        height: FLOAT_DEFAULT_RECTS.lens.height,
        isCollapsed: false,
      })
      const inset = await listInsetRepository.getById(id)
      if (inset) {
        set({ insets: [...get().insets, inset] })
      }
      return id
    }, 'Failed to add list inset')
  },

  async update(inset: ListInset) {
    const prev = get().insets.find((i) => i.id === inset.id)
    if (!prev || inset.id == null) return
    return optimistic(
      set,
      () => set({ insets: updateItemInList(get().insets, inset.id!, inset) }),
      () => listInsetRepository.update(inset),
      () => set({ insets: updateItemInList(get().insets, inset.id!, prev) }),
      'Failed to update list inset',
    )
  },

  async updatePosition(id: number, x: number, y: number) {
    const prev = get().insets.find((i) => i.id === id)
    if (!prev) return
    const { x: cx, y: cy } = clampCanvasPosition(x, y)
    return optimistic(
      set,
      () => set({ insets: updateItemInList(get().insets, id, { x: cx, y: cy }) }),
      () => listInsetRepository.updatePosition(id, cx, cy),
      () => set({ insets: updateItemInList(get().insets, id, { x: prev.x, y: prev.y }) }),
      'Failed to update list inset position',
    )
  },

  async remove(id: number) {
    return mutate(set, async () => {
      const inset = get().insets.find((i) => i.id === id)
      await listInsetRepository.remove(id)
      set({ insets: get().insets.filter((i) => i.id !== id) })
      if (inset) {
        undoable(
          `Delete list inset`,
          () => get().remove(id),
          async () => {
            await listInsetRepository.insert(inset)
            set({ insets: [...get().insets, inset] })
          },
          true,
        )
      }
    }, 'Failed to delete list inset')
  },
}))
