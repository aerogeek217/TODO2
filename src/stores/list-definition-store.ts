import { create } from 'zustand'
import { listDefinitionRepository } from '../data/list-definition-repository'
import {
  type LayoutListOwner,
  type ListDefinition,
  type ListGrouping,
  type ListMembership,
  type ListSort,
  type PersistedListDefinition,
  type RuntimeFilterSpec,
} from '../models/list-definition'
import { emptyPredicate } from '../models'
import { effectiveSortDirection, type TodoSortDirection } from '../models/todo-sort-group'
import { loadFresh, mutate, optimistic, makeEnsureLoaded } from './store-helpers'
import { useListOrderStore } from './list-order-store'
import { useSettingsStore } from './settings-store'
import { UndoGone, useUndoStore } from './undo-store'
import { undoable } from './undoable'
import { assertNoReplaceHold, refusedByReplaceHold } from './replace-hold'
import { configPatch, withConfigPatch } from '../utils/config-patch'
import { defsEqual } from '../utils/list-def-equal'

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
  /** Who the list belongs to: the layout whose tab shows it. */
  owner: LayoutListOwner
}

interface ListDefinitionState {
  listDefinitions: PersistedListDefinition[]
  /** A load has read the rows (a failed load leaves it false, so `ensureLoaded` retries). */
  loaded: boolean

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  add: (input: AddInput) => Promise<number>
  /**
   * Writes `def` over the stored list (no undo step). Rejects when the
   * write fails (the store then has the list as it was). Under a data
   * replace's hold (`replace-hold`) nothing is written.
   */
  update: (def: PersistedListDefinition) => Promise<void>
  /**
   * An edit of list `id` (`fn` over its stored definition), written for good
   * as one undo step with the snackbar (`description`: `Edited list “This
   * week”`). Only what the list's own editors change is taken from `fn`'s
   * result: its id, sort order, owner and lens switch stay the stored ones,
   * and a blank name keeps the stored name. Undo puts back the keys it
   * changed — over the list as it is then, so a later write to another part
   * (the lens switch) stays — and Redo writes them again; either says so
   * when the list is gone. Resolves whether it wrote (nothing changed, an
   * unknown list, a failed write — the snackbar says so — or a data replace
   * under way: false).
   */
  editList: (id: number, fn: (def: PersistedListDefinition) => PersistedListDefinition, description: string) => Promise<boolean>
  /**
   * Whether the top bar's lens applies to list `id` (`ListDefinition.ignoreLens`),
   * saved at once on the saved list — never a draft edit, so it neither
   * makes the list unsaved nor waits for its Save.
   */
  setIgnoreLens: (id: number, ignore: boolean) => Promise<void>
  /** Drops lists the database no longer has (deleted with their layout) from the store. */
  forgetLists: (ids: readonly number[]) => void
}

/**
 * `edited` as `editList` writes it over `saved`: its name trimmed (a blank
 * one keeps the saved name), and the saved list's id, sort order, owner and
 * lens switch — none of them an edit of the list's editors.
 */
function editedOf(edited: PersistedListDefinition, saved: PersistedListDefinition): PersistedListDefinition {
  const { owner: _owner, ignoreLens: _lens, ...rest } = edited
  void _owner
  void _lens
  return {
    ...rest,
    id: saved.id,
    sortOrder: saved.sortOrder,
    name: edited.name.trim() || saved.name,
    ...(saved.owner ? { owner: saved.owner } : {}),
    ...(saved.ignoreLens ? { ignoreLens: true as const } : {}),
  }
}

/**
 * Whether `editList(id, fn, …)` has something to write now: list `id`
 * exists and `fn` changes one of its editors' parts. `editList` resolves
 * false both for nothing to write and for a write that failed; a caller
 * that keeps a draft until its write has landed (Edit list's Save) tells
 * the two apart with this.
 */
export function listEditChanges(id: number, fn: (def: PersistedListDefinition) => PersistedListDefinition): boolean {
  const saved = useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)
  return saved != null && !defsEqual(editedOf(fn(saved), saved), saved)
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

  async add({ name, membership, sort, sortDirection, grouping, runtimeFilter, showFilterLine, owner }) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Name is required')
    // What isn't given starts as Settings' new-list defaults.
    const defaults = useSettingsStore.getState()
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
        const { id, sortOrder } = await listDefinitionRepository.insertLast(entry)
        set({ listDefinitions: [...get().listDefinitions, { ...entry, sortOrder, id }] })
        return id
      },
      'Failed to add list',
    )
  },

  async update(def) {
    if (refusedByReplaceHold()) return
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

  async editList(id, fn, description) {
    if (refusedByReplaceHold()) return false
    const saved = get().listDefinitions.find((d) => d.id === id)
    if (!saved) return false
    const next = editedOf(fn(saved), saved)
    if (defsEqual(next, saved)) return false
    const forward = configPatch(saved, next)
    const back = configPatch(next, saved)
    try {
      await get().update(next)
    } catch {
      useUndoStore.getState().notify(`Couldn't save list “${saved.name}”.`)
      return false
    }
    const replay = (patch: Partial<PersistedListDefinition>) => async () => {
      assertNoReplaceHold()
      const now = get().listDefinitions.find((d) => d.id === id)
      if (!now) throw new UndoGone(`The list “${next.name}” is gone.`)
      await get().update(withConfigPatch(now, patch))
    }
    undoable(description, replay(forward), replay(back), true)
    return true
  },

  async setIgnoreLens(id, ignore) {
    const saved = get().listDefinitions.find((d) => d.id === id)
    if (!saved || (saved.ignoreLens === true) === ignore) return
    const { ignoreLens: _was, ...rest } = saved
    void _was
    await get().update(ignore ? { ...rest, ignoreLens: true } : rest)
  },

  forgetLists(ids) {
    if (ids.length === 0) return
    const gone = new Set(ids)
    set({ listDefinitions: get().listDefinitions.filter((d) => !gone.has(d.id)) })
    for (const id of ids) useListOrderStore.getState().forgetList(id)
  },
  }
})
