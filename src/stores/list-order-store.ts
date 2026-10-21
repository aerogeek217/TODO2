import { create } from 'zustand'
import { listOrderRepository } from '../data/list-order-repository'
import type { PersistedListOrder } from '../models/list-order'
import type { ListRanks, RankWrite } from '../utils/list-order'
import { loadFresh, trackWrite } from './store-helpers'
import { registerModuleReset } from '../utils/module-reset'

const NO_RANKS: ListRanks = new Map()

/**
 * Manual list order: every list's ranks (`listOrders`), loaded once. Order
 * changes save at once — they are not part of a list's unsaved edits.
 */
interface ListOrderState {
  /** List id → (todo id → rank). */
  ranks: ReadonlyMap<number, ListRanks>
  loaded: boolean

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  /** Sets ranks in a list (a move: usually one row). */
  setRanks: (listDefinitionId: number, writes: readonly RankWrite[]) => Promise<void>
  /** Replaces a list's whole order (switching a list to manual order). */
  replaceList: (listDefinitionId: number, writes: readonly RankWrite[]) => Promise<void>
  /** Drops deleted tasks' ranks from memory (the repository deletes the rows). */
  forgetTodos: (todoIds: readonly number[]) => void
  /** Drops a deleted list's ranks from memory (the repository deletes the rows). */
  forgetList: (listDefinitionId: number) => void
  /** Puts deleted rows back (undo). */
  restoreRows: (rows: readonly PersistedListOrder[]) => Promise<void>
  /** A new list's ranks the repository already wrote (a copied list's), into memory. */
  rememberList: (listDefinitionId: number, ranks: readonly RankWrite[]) => void
}

function group(rows: readonly PersistedListOrder[]): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>()
  for (const r of rows) {
    let list = out.get(r.listDefinitionId)
    if (!list) {
      list = new Map()
      out.set(r.listDefinitionId, list)
    }
    list.set(r.todoId, r.rank)
  }
  return out
}

let inflight: Promise<void> | null = null

/**
 * Forgets the load in flight, for tests that share one module instance (the
 * store's state is reset separately). That load finishes on its own.
 */
export function resetListOrderLoad(): void {
  inflight = null
}
registerModuleReset(resetListOrderLoad)

/** Awaits a rank write; false (logged) when it failed. */
async function saveOrLog(write: Promise<void>): Promise<boolean> {
  try {
    await write
    return true
  } catch (e) {
    console.error('Failed to save list order:', e)
    return false
  }
}

export const useListOrderStore = create<ListOrderState>((set, get) => {
  const withList = (listDefinitionId: number, fn: (ranks: Map<number, number>) => void) => {
    const next = new Map(get().ranks)
    const list = new Map(next.get(listDefinitionId) ?? NO_RANKS)
    fn(list)
    if (list.size > 0) next.set(listDefinitionId, list)
    else next.delete(listDefinitionId)
    set({ ranks: next })
  }

  return {
    ranks: new Map(),
    loaded: false,

    async load() {
      // Never rejects (a refresh of every store, a failed save's reload and
      // drag handlers wait on it): a failed read is reported, ranks kept.
      const rows = await loadFresh(() => listOrderRepository.getAll(), 'the manual task order')
      if (rows) set({ ranks: group(rows), loaded: true })
    },

    ensureLoaded() {
      if (get().loaded) return Promise.resolve()
      // A failed load leaves `loaded` false: reported, and retried next time.
      if (inflight) return inflight
      const run: Promise<void> = get().load()
        .finally(() => { if (inflight === run) inflight = null })
      inflight = run
      return run
    },

    async setRanks(listDefinitionId, writes) {
      if (writes.length === 0) return
      const saved = await trackWrite(async () => {
        withList(listDefinitionId, (list) => {
          for (const w of writes) list.set(w.todoId, w.rank)
        })
        return saveOrLog(listOrderRepository.setRanks(listDefinitionId, writes))
      })
      // Outside the tracked write: the reload waits for writes to settle.
      if (!saved) await get().load()
    },

    async replaceList(listDefinitionId, writes) {
      const saved = await trackWrite(async () => {
        withList(listDefinitionId, (list) => {
          list.clear()
          for (const w of writes) list.set(w.todoId, w.rank)
        })
        return saveOrLog(listOrderRepository.replaceList(listDefinitionId, writes))
      })
      if (!saved) await get().load()
    },

    forgetTodos(todoIds) {
      if (todoIds.length === 0) return
      const doomed = new Set(todoIds)
      let changed = false
      const next = new Map<number, ListRanks>()
      for (const [listId, list] of get().ranks) {
        if (![...list.keys()].some((id) => doomed.has(id))) {
          next.set(listId, list)
          continue
        }
        changed = true
        const kept = new Map([...list].filter(([id]) => !doomed.has(id)))
        if (kept.size > 0) next.set(listId, kept)
      }
      if (changed) set({ ranks: next })
    },

    forgetList(listDefinitionId) {
      if (!get().ranks.has(listDefinitionId)) return
      const next = new Map(get().ranks)
      next.delete(listDefinitionId)
      set({ ranks: next })
    },

    rememberList(listDefinitionId, ranks) {
      if (ranks.length === 0) return
      withList(listDefinitionId, (list) => {
        for (const r of ranks) list.set(r.todoId, r.rank)
      })
    },

    async restoreRows(rows) {
      if (rows.length === 0) return
      await trackWrite(async () => {
        await listOrderRepository.restore(rows)
        const next = new Map(get().ranks)
        for (const [listId, restored] of group(rows)) {
          next.set(listId, new Map([...(next.get(listId) ?? NO_RANKS), ...restored]))
        }
        set({ ranks: next })
      })
    },
  }
})

/** A list's ranks, kept current (an empty map when it has none). */
export function useListRanks(listDefinitionId: number | undefined): ListRanks {
  return useListOrderStore((s) => (listDefinitionId != null ? s.ranks.get(listDefinitionId) : undefined) ?? NO_RANKS)
}
