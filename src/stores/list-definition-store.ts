import { create } from 'zustand'
import { listDefinitionRepository } from '../data/list-definition-repository'
import type {
  ListDefinition,
  ListGrouping,
  ListMembership,
  ListSort,
  PersistedListDefinition,
} from '../models/list-definition'
import type { TodoPredicate } from '../models'
import { loadWithState, mutate, optimistic, makeEnsureLoaded, trackWrite } from './store-helpers'
import { undoable } from '../services/undoable'
import { bySortOrder } from '../utils/sort-order'
import { listOrderRepository } from '../data/list-order-repository'
import { useListOrderStore } from './list-order-store'
import { useSettingsStore } from './settings-store'

interface AddInput {
  name: string
  membership?: ListMembership
  sort?: ListSort
  grouping?: ListGrouping
  pinnedToDashboard?: boolean
  maxTasks?: number
  limitMode?: 'hard' | 'scroll'
}

interface ListDefinitionState {
  listDefinitions: PersistedListDefinition[]
  loading: boolean
  /** A load has read the rows (a failed load leaves it false, so `ensureLoaded` retries). */
  loaded: boolean
  error: string | null

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  add: (input: AddInput) => Promise<number>
  update: (def: PersistedListDefinition) => Promise<void>
  remove: (id: number) => Promise<void>
  reorder: (fromIndex: number, toIndex: number) => Promise<void>
}

/** Empty predicate — matches every open task (completed tasks need `showCompleted`). */
export function emptyPredicate(): TodoPredicate {
  return {
    showCompleted: false,
    personIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'deadline',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasDeadline: null,
    hasFollowup: null,
    markers: null,
    tags: null,
  }
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

function nextSortOrder(defs: PersistedListDefinition[]): number {
  return defs.reduce((max, d) => Math.max(max, d.sortOrder), -1) + 1
}

export const useListDefinitionStore = create<ListDefinitionState>((set, get) => {
  const defEnsure = makeEnsureLoaded(() => get().load(), () => get().loaded)
  return {
  listDefinitions: [],
  loading: false,
  loaded: false,
  error: null,

  async load() {
    const rows = await loadWithState(set, () => listDefinitionRepository.getAll(), 'saved lists')
    if (rows) set({ listDefinitions: rows, loaded: true })
  },
  ensureLoaded: defEnsure,

  async add({ name, membership, sort, grouping, pinnedToDashboard = true, maxTasks, limitMode }) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Name is required')
    const { listDefinitions } = get()
    const entry: ListDefinition = {
      name: trimmed,
      sortOrder: nextSortOrder(listDefinitions),
      pinnedToDashboard,
      membership: membership ?? { kind: 'custom', predicate: emptyPredicate() },
      sort: sort ?? 'manual',
      grouping: grouping ?? 'none',
      ...(maxTasks != null ? { maxTasks } : {}),
      ...(limitMode != null ? { limitMode } : {}),
    }
    return mutate(
      set,
      async () => {
        const id = await listDefinitionRepository.insert(entry)
        set({ listDefinitions: [...get().listDefinitions, { ...entry, id }] })
        return id
      },
      'Failed to add list',
    )
  },

  async update(def) {
    const prev = get().listDefinitions
    await optimistic(
      set,
      () => set({ listDefinitions: prev.map(d => d.id === def.id ? { ...def } : d) }),
      () => listDefinitionRepository.update(def),
      () => set({ listDefinitions: prev }),
      'Failed to update list',
    )
  },

  remove(id) {
    return trackWrite(async () => {
      const prev = get().listDefinitions
      const def = prev.find(d => d.id === id)
      if (!def) return

      const ranks = await listOrderRepository.getByList(id)
      await listDefinitionRepository.remove(id)
      useListOrderStore.getState().forgetList(id)
      set({ listDefinitions: prev.filter(d => d.id !== id) })
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
        set({ listDefinitions: prev, error: 'Failed to reorder list definitions' })
      }
    })
  },
  }
})
