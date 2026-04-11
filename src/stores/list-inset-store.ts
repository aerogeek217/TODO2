import { create } from 'zustand'
import type { ListInset, ListInsetPreset, ListInsetAttributeFilter } from '../models'
import { listInsetRepository } from '../data'
import { undoable } from '../services/undoable'

interface ListInsetState {
  insets: ListInset[]
  loading: boolean
  error: string | null

  loadByCanvas: (canvasId: number) => Promise<void>
  add: (name: string, preset: ListInsetPreset, canvasId: number, x: number, y: number) => Promise<number>
  addFiltered: (name: string, filter: ListInsetAttributeFilter, canvasId: number, x: number, y: number) => Promise<number>
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

  async add(name: string, preset: ListInsetPreset, canvasId: number, x: number, y: number) {
    const id = await listInsetRepository.insert({
      name,
      preset,
      canvasId,
      x,
      y,
      width: 280,
      height: 300,
      isCollapsed: false,
    })
    const inset = await listInsetRepository.getById(id)
    if (inset) {
      set({ insets: [...get().insets, inset] })
    }
    return id
  },

  async addFiltered(name: string, filter: ListInsetAttributeFilter, canvasId: number, x: number, y: number) {
    const id = await listInsetRepository.insert({
      name,
      attributeFilter: filter,
      canvasId,
      x,
      y,
      width: 320,
      height: 300,
      isCollapsed: false,
    })
    const inset = await listInsetRepository.getById(id)
    if (inset) {
      set({ insets: [...get().insets, inset] })
    }
    return id
  },

  async update(inset: ListInset) {
    await listInsetRepository.update(inset)
    set({
      insets: get().insets.map((i) => (i.id === inset.id ? { ...inset } : i)),
    })
  },

  async updatePosition(id: number, x: number, y: number) {
    await listInsetRepository.updatePosition(id, x, y)
    set({
      insets: get().insets.map((i) => (i.id === id ? { ...i, x, y } : i)),
    })
  },

  async remove(id: number) {
    const inset = get().insets.find((i) => i.id === id)
    await listInsetRepository.remove(id)
    set({ insets: get().insets.filter((i) => i.id !== id) })
    if (inset) {
      undoable(
        `Delete list inset "${inset.name}"`,
        () => get().remove(id),
        async () => {
          await listInsetRepository.insert(inset)
          set({ insets: [...get().insets, inset] })
        },
        true,
      )
    }
  },
}))
