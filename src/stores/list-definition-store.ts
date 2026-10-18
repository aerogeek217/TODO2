import { create } from 'zustand'
import { listDefinitionRepository } from '../data/list-definition-repository'
import type {
  ListDefinition,
  ListGrouping,
  ListMembership,
  ListSort,
  PersistedListDefinition,
} from '../models/list-definition'
import { emptyPredicate } from '../models'
import { loadFresh, mutate, optimistic, makeEnsureLoaded, trackWrite } from './store-helpers'
import { undoable } from './undoable'
import { bySortOrder } from '../utils/sort-order'
import { listOrderRepository } from '../data/list-order-repository'
import { useListOrderStore } from './list-order-store'
import { useSettingsStore } from './settings-store'

interface AddInput {
  name: string
  membership?: ListMembership
  sort?: ListSort
  grouping?: ListGrouping
}

interface ListDefinitionState {
  listDefinitions: PersistedListDefinition[]
  /** A load has read the rows (a failed load leaves it false, so `ensureLoaded` retries). */
  loaded: boolean

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  add: (input: AddInput) => Promise<number>
  update: (def: PersistedListDefinition) => Promise<void>
  remove: (id: number) => Promise<void>
  reorder: (fromIndex: number, toIndex: number) => Promise<void>
}

/**
 * A check-in scope on the deleted list goes back to all open tasks. Returns
 * whether it pointed at the list (so undo can restore it).
 */
async function clearCheckinScopeFor(listDefinitionId: number): Promise<boolean> {
  const settings = useSettingsStore.getState()
  const scope = settings.checkinTaskScope
  if (scope.kind !== 'list' || scope.listDefinitionId !== listDefinitionId) return false
  await settings.setCheckinTaskScope({ kind: 'all' })
  return true
}

export const useListDefinitionStore = create<ListDefinitionState>((set, get) => {
  const defEnsure = makeEnsureLoaded(() => get().load(), () => get().loaded)
  return {
  listDefinitions: [],
  loaded: false,

  async load() {
    const rows = await loadFresh(() => listDefinitionRepository.getAll(), 'saved lists')
    if (rows) set({ listDefinitions: rows, loaded: true })
  },
  ensureLoaded: defEnsure,

  async add({ name, membership, sort, grouping }) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Name is required')
    const entry: Omit<ListDefinition, 'sortOrder'> = {
      name: trimmed,
      membership: membership ?? { kind: 'custom', predicate: emptyPredicate() },
      sort: sort ?? 'manual',
      grouping: grouping ?? 'none',
    }
    return mutate(
      async () => {
        // Goes last (the repository picks the sort order in its transaction).
        const { id, sortOrder } = await listDefinitionRepository.insertLast(entry)
        set({ listDefinitions: [...get().listDefinitions, { ...entry, sortOrder, id }] })
        return id
      },
      'Failed to add list',
    )
  },

  async update(def) {
    const prev = get().listDefinitions.find(d => d.id === def.id)
    const applied = { ...def }
    const put = (next: PersistedListDefinition) =>
      set({ listDefinitions: get().listDefinitions.map(d => d.id === next.id ? next : d) })
    await optimistic(
      () => put(applied),
      () => listDefinitionRepository.update(def),
      // Only this list, and only while it still holds this edit.
      () => { if (prev && get().listDefinitions.find(d => d.id === def.id) === applied) put(prev) },
      'Failed to update list',
    )
  },

  remove(id) {
    return trackWrite(async () => {
      const def = get().listDefinitions.find(d => d.id === id)
      if (!def) return

      const ranks = await listOrderRepository.getByList(id)
      await listDefinitionRepository.remove(id)
      useListOrderStore.getState().forgetList(id)
      // The lists as they are now: another write may have landed meanwhile.
      set({ listDefinitions: get().listDefinitions.filter(d => d.id !== id) })
      const scopeCleared = await clearCheckinScopeFor(id)

      undoable(
        `Delete list "${def.name}"`,
        () => get().remove(id),
        async () => {
          await listDefinitionRepository.restore(def)
          await useListOrderStore.getState().restoreRows(ranks)
          await get().load()
          // Undo brings back the check-in choice too, unless it was changed since.
          const settings = useSettingsStore.getState()
          if (scopeCleared && settings.checkinTaskScope.kind === 'all') {
            await settings.setCheckinTaskScope({ kind: 'list', listDefinitionId: id })
          }
        },
        true,
      )
    })
  },

  reorder(fromIndex, toIndex) {
    return trackWrite(async () => {
      const prev = get().listDefinitions
      const sorted = [...prev].sort(bySortOrder)
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= sorted.length || toIndex >= sorted.length) return
      const [moved] = sorted.splice(fromIndex, 1)
      if (!moved) return
      sorted.splice(toIndex, 0, moved)
      const updated = sorted.map((d, i) => ({ ...d, sortOrder: i }))
      set({ listDefinitions: updated })
      try {
        await listDefinitionRepository.reorder(updated.map(d => d.id))
      } catch (e) {
        console.error('Failed to reorder list definitions:', e)
        set({ listDefinitions: prev })
      }
    })
  },
  }
})
