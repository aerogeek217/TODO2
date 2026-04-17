import { create } from 'zustand'
import { listDefinitionRepository } from '../data/list-definition-repository'
import type { PersistedListDefinition } from '../models/list-definition'

interface ListDefinitionState {
  listDefinitions: PersistedListDefinition[]
  loading: boolean
  error: string | null
  load: () => Promise<void>
}

export const useListDefinitionStore = create<ListDefinitionState>((set) => ({
  listDefinitions: [],
  loading: false,
  error: null,
  async load() {
    set({ loading: true, error: null })
    try {
      const rows = await listDefinitionRepository.getAll()
      set({ listDefinitions: rows })
    } catch (e) {
      console.error('Failed to load list definitions:', e)
      set({ error: 'Failed to load list definitions' })
    } finally {
      set({ loading: false })
    }
  },
}))
