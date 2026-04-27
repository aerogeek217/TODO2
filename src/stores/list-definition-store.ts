import { create } from 'zustand'
import { listDefinitionRepository } from '../data/list-definition-repository'
import { db } from '../data/database'
import type {
  ListDefinition,
  ListGrouping,
  ListMembership,
  ListSort,
  PersistedListDefinition,
} from '../models/list-definition'
import type { TodoPredicate } from '../models'
import { loadWithState, mutate, optimistic, makeEnsureLoaded } from './store-helpers'
import { undoable } from '../services/undoable'

interface AddInput {
  name: string
  membership?: ListMembership
  sort?: ListSort
  grouping?: ListGrouping
  pinnedToDashboard?: boolean
  favorited?: boolean
  maxTasks?: number
  limitMode?: 'hard' | 'scroll'
}

interface ListDefinitionState {
  listDefinitions: PersistedListDefinition[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  add: (input: AddInput) => Promise<number>
  update: (def: PersistedListDefinition) => Promise<void>
  rename: (id: number, name: string) => Promise<void>
  setPinned: (id: number, pinned: boolean) => Promise<void>
  setFavorited: (id: number, favorited: boolean) => Promise<void>
  remove: (id: number) => Promise<void>
  clone: (id: number) => Promise<number | undefined>
  reorder: (fromIndex: number, toIndex: number) => Promise<void>
}

/** Empty predicate — matches all tasks aside from the standard completed/hidden gates. */
export function emptyPredicate(): TodoPredicate {
  return {
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
    tags: null,
  }
}

function nextSortOrder(defs: PersistedListDefinition[]): number {
  return defs.reduce((max, d) => Math.max(max, d.sortOrder), -1) + 1
}

export const useListDefinitionStore = create<ListDefinitionState>((set, get) => {
  const defEnsure = makeEnsureLoaded(() => get().load())
  return {
  listDefinitions: [],
  loading: false,
  error: null,

  async load() {
    const rows = await loadWithState(set, () => listDefinitionRepository.getAll(), 'list definitions')
    if (rows) set({ listDefinitions: rows })
  },
  ensureLoaded: () => defEnsure.ensureLoaded(),

  async add({ name, membership, sort, grouping, pinnedToDashboard = true, favorited = false, maxTasks, limitMode }) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Name is required')
    const { listDefinitions } = get()
    const entry: ListDefinition = {
      name: trimmed,
      sortOrder: nextSortOrder(listDefinitions),
      pinnedToDashboard,
      favorited,
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

  async rename(id, name) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Name is required')
    const def = get().listDefinitions.find(d => d.id === id)
    if (!def || def.name === trimmed) return
    await get().update({ ...def, name: trimmed })
  },

  async setPinned(id, pinned) {
    const def = get().listDefinitions.find(d => d.id === id)
    if (!def || def.pinnedToDashboard === pinned) return
    await get().update({ ...def, pinnedToDashboard: pinned })
  },

  async setFavorited(id, favorited) {
    const def = get().listDefinitions.find(d => d.id === id)
    if (!def || def.favorited === favorited) return
    await get().update({ ...def, favorited })
  },

  async remove(id) {
    const prev = get().listDefinitions
    const def = prev.find(d => d.id === id)
    if (!def) return

    await listDefinitionRepository.remove(id)
    set({ listDefinitions: prev.filter(d => d.id !== id) })

    undoable(
      `Delete list "${def.name}"`,
      () => get().remove(id),
      async () => {
        await db.listDefinitions.add(def)
        await get().load()
      },
      true,
    )
  },

  async clone(id) {
    const src = get().listDefinitions.find(d => d.id === id)
    if (!src) return undefined
    const defs = get().listDefinitions
    let candidate = `${src.name} copy`
    let n = 2
    const lower = new Set(defs.map(d => d.name.toLowerCase()))
    while (lower.has(candidate.toLowerCase())) {
      candidate = `${src.name} copy ${n++}`
    }
    return get().add({
      name: candidate,
      membership: src.membership,
      sort: src.sort,
      grouping: src.grouping,
      pinnedToDashboard: src.pinnedToDashboard,
      favorited: src.favorited,
      ...(src.maxTasks != null ? { maxTasks: src.maxTasks } : {}),
      ...(src.limitMode != null ? { limitMode: src.limitMode } : {}),
    })
  },

  async reorder(fromIndex, toIndex) {
    const prev = get().listDefinitions
    const sorted = [...prev].sort((a, b) => a.sortOrder - b.sortOrder)
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
  },
  }
})
