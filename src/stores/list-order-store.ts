import { create } from 'zustand'
import { listOrderRepository } from '../data/list-order-repository'
import type { PersistedListOrder } from '../models/list-order'
import type { ListRanks, RankWrite } from '../utils/list-order'

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
      const rows = await listOrderRepository.getAll()
      set({ ranks: group(rows), loaded: true })
    },

    ensureLoaded() {
      if (get().loaded) return Promise.resolve()
      inflight ??= get().load().finally(() => { inflight = null })
      return inflight
    },

    async setRanks(listDefinitionId, writes) {
      if (writes.length === 0) return
      withList(listDefinitionId, (list) => {
        for (const w of writes) list.set(w.todoId, w.rank)
      })
      try {
        await listOrderRepository.setRanks(listDefinitionId, writes)
      } catch (e) {
        console.error('Failed to save list order:', e)
        await get().load()
      }
    },

    async replaceList(listDefinitionId, writes) {
      withList(listDefinitionId, (list) => {
        list.clear()
        for (const w of writes) list.set(w.todoId, w.rank)
      })
      try {
        await listOrderRepository.replaceList(listDefinitionId, writes)
      } catch (e) {
        console.error('Failed to save list order:', e)
        await get().load()
      }
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

    async restoreRows(rows) {
      if (rows.length === 0) return
      await listOrderRepository.restore(rows)
      const next = new Map(get().ranks)
      for (const [listId, restored] of group(rows)) {
        next.set(listId, new Map([...(next.get(listId) ?? NO_RANKS), ...restored]))
      }
      set({ ranks: next })
    },
  }
})

/** A list's ranks, kept current (an empty map when it has none). */
export function useListRanks(listDefinitionId: number | undefined): ListRanks {
  return useListOrderStore((s) => (listDefinitionId != null ? s.ranks.get(listDefinitionId) : undefined) ?? NO_RANKS)
}
