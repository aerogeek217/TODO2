import { create } from 'zustand'
import type { ListInset, ListInsetPreset, ListInsetAttributeFilter } from '../models'
import { listInsetRepository } from '../data'
import { undoable } from '../services/undoable'
import { mutate } from './store-helpers'

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
    return mutate(set, async () => {
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
    }, 'Failed to add list inset')
  },

  async addFiltered(name: string, filter: ListInsetAttributeFilter, canvasId: number, x: number, y: number) {
    return mutate(set, async () => {
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
    }, 'Failed to add filtered list inset')
  },

  async update(inset: ListInset) {
    return mutate(set, async () => {
      await listInsetRepository.update(inset)
      set({
        insets: get().insets.map((i) => (i.id === inset.id ? { ...inset } : i)),
      })
    }, 'Failed to update list inset')
  },

  async updatePosition(id: number, x: number, y: number) {
    return mutate(set, async () => {
      await listInsetRepository.updatePosition(id, x, y)
      set({
        insets: get().insets.map((i) => (i.id === id ? { ...i, x, y } : i)),
      })
    }, 'Failed to update list inset position')
  },

  async remove(id: number) {
    return mutate(set, async () => {
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
    }, 'Failed to delete list inset')
  },
}))
