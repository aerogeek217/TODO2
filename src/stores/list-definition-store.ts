import { create } from 'zustand'
import { listDefinitionRepository } from '../data/list-definition-repository'
import {
  type ListDefinition,
  type ListOwner,
  type ListGrouping,
  type ListMembership,
  type ListSort,
  type PersistedListDefinition,
  type RuntimeFilterSpec,
  isEisenhowerOwner,
} from '../models/list-definition'
import { emptyPredicate } from '../models'
import { effectiveSortDirection, type TodoSortDirection } from '../models/todo-sort-group'
import { loadFresh, mutate, optimistic, makeEnsureLoaded, trackWrite } from './store-helpers'
import { useListOrderStore } from './list-order-store'
import { useSettingsStore } from './settings-store'

/**
 * A new list. A sort or grouping not given is Settings' new-list default
 * (`newListSort` + `newListSortDirection` / `newListGroup`) — a blank list;
 * a copy passes its source's. `sortDirection` goes with a given `sort`.
 */
interface AddInput {
  name: string
  membership?: ListMembership
  sort?: ListSort
  sortDirection?: TodoSortDirection
  grouping?: ListGrouping
  runtimeFilter?: RuntimeFilterSpec
  showFilterLine?: false
  /** Who the list belongs to: the layout whose tab shows it (or the Eisenhower). */
  owner: ListOwner
  /** A copy of this list: its manual order is copied with it, in the same transaction. */
  ranksFrom?: number
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

  async add({ name, membership, sort, sortDirection, grouping, runtimeFilter, showFilterLine, owner, ranksFrom }) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Name is required')
    // What isn't given starts as Settings' new-list defaults (the
    // Eisenhower's own list, whose sort and grouping nothing reads, as none).
    const defaults = isEisenhowerOwner(owner)
      ? { newListSort: 'manual' as const, newListSortDirection: 'asc' as const, newListGroup: 'none' as const }
      : useSettingsStore.getState()
    const listSort = sort ?? defaults.newListSort
    const direction = effectiveSortDirection(listSort, sort != null ? sortDirection : defaults.newListSortDirection)
    const entry: Omit<ListDefinition, 'sortOrder'> = {
      name: trimmed,
      membership: membership ?? { kind: 'custom', predicate: emptyPredicate() },
      sort: listSort,
      ...(direction === 'desc' ? { sortDirection: direction } : {}),
      grouping: grouping ?? defaults.newListGroup,
      ...(runtimeFilter ? { runtimeFilter } : {}),
      ...(showFilterLine === false ? { showFilterLine } : {}),
      owner,
    }
    return mutate(
      async () => {
        // Goes last (the repository picks the sort order in its transaction).
        if (ranksFrom != null) {
          const { id, sortOrder, ranks } = await listDefinitionRepository.insertCopy(entry, ranksFrom)
          set({ listDefinitions: [...get().listDefinitions, { ...entry, sortOrder, id }] })
          useListOrderStore.getState().rememberList(id, ranks)
          return id
        }
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
