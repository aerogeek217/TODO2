import { create } from 'zustand'
import { listDefinitionRepository } from '../data/list-definition-repository'
import {
  type ListDefinition,
  type ListOwner,
  type ListGrouping,
  type ListMembership,
  type ListSort,
  type PersistedListDefinition,
} from '../models/list-definition'
import { emptyPredicate } from '../models'
import { loadFresh, mutate, optimistic, makeEnsureLoaded, trackWrite } from './store-helpers'
import { useListOrderStore } from './list-order-store'
import { useSettingsStore } from './settings-store'

interface AddInput {
  name: string
  membership?: ListMembership
  sort?: ListSort
  grouping?: ListGrouping
  /** Who the list belongs to: the layout whose tab shows it (or the Eisenhower). */
  owner: ListOwner
}

interface ListDefinitionState {
  listDefinitions: PersistedListDefinition[]
  /** A load has read the rows (a failed load leaves it false, so `ensureLoaded` retries). */
  loaded: boolean

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  add: (input: AddInput) => Promise<number>
  update: (def: PersistedListDefinition) => Promise<void>
  /**
   * The Eisenhower's own list (made when there is none —
   * `listDefinitionRepository.ensureEisenhowerList`), with the lists and
   * `settings-store.eisenhowerListId` reloaded to name it. Returns its id.
   */
  ensureEisenhowerList: () => Promise<number>
  /** Drops lists the database no longer has (deleted with their layout) from the store. */
  forgetLists: (ids: readonly number[]) => void
}

export const useListDefinitionStore = create<ListDefinitionState>((set, get) => {
  const defEnsure = makeEnsureLoaded(() => get().load(), () => get().loaded)
  return {
  listDefinitions: [],
  loaded: false,

  async load() {
    const rows = await loadFresh(() => listDefinitionRepository.getAll(), 'lists')
    if (rows) set({ listDefinitions: rows, loaded: true })
  },
  ensureLoaded: defEnsure,

  async add({ name, membership, sort, grouping, owner }) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Name is required')
    const entry: Omit<ListDefinition, 'sortOrder'> = {
      name: trimmed,
      membership: membership ?? { kind: 'custom', predicate: emptyPredicate() },
      sort: sort ?? 'manual',
      grouping: grouping ?? 'none',
      owner,
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

  async ensureEisenhowerList() {
    const id = await trackWrite(() => listDefinitionRepository.ensureEisenhowerList())
    useSettingsStore.setState({ eisenhowerListId: id })
    // After the tracked write (a load waits for writes in flight).
    if (!get().listDefinitions.some((d) => d.id === id)) await get().load()
    return id
  },

  forgetLists(ids) {
    if (ids.length === 0) return
    const gone = new Set(ids)
    set({ listDefinitions: get().listDefinitions.filter((d) => !gone.has(d.id)) })
    for (const id of ids) useListOrderStore.getState().forgetList(id)
  },
  }
})
