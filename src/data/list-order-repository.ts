import { db } from './database'
import type { ListOrder, PersistedListOrder } from '../models/list-order'
import type { RankWrite } from '../utils/list-order'

/**
 * Manual list order (`listOrders`): one rank per (list, task) pair. Writes
 * upsert on the pair, so a move writes the one row it changes.
 */
export const listOrderRepository = {
  async getAll(): Promise<PersistedListOrder[]> {
    return (await db.listOrders.toArray()) as PersistedListOrder[]
  },

  async getByList(listDefinitionId: number): Promise<PersistedListOrder[]> {
    return (await db.listOrders.where('listDefinitionId').equals(listDefinitionId).toArray()) as PersistedListOrder[]
  },

  async getByTodos(todoIds: readonly number[]): Promise<PersistedListOrder[]> {
    if (todoIds.length === 0) return []
    return (await db.listOrders.where('todoId').anyOf([...todoIds]).toArray()) as PersistedListOrder[]
  },

  /** Sets the ranks of `writes` in the list (inserting rows for unranked tasks). */
  async setRanks(listDefinitionId: number, writes: readonly RankWrite[]): Promise<void> {
    if (writes.length === 0) return
    await db.transaction('rw', db.listOrders, async () => {
      const existing = await db.listOrders
        .where('[listDefinitionId+todoId]')
        .anyOf(writes.map((w) => [listDefinitionId, w.todoId]))
        .toArray()
      const idByTodo = new Map(existing.map((r) => [r.todoId, r.id]))
      await db.listOrders.bulkPut(writes.map((w): ListOrder => {
        const id = idByTodo.get(w.todoId)
        return { ...(id != null ? { id } : {}), listDefinitionId, todoId: w.todoId, rank: w.rank }
      }))
    })
  },

  /** Puts rows back as they were (undo of a delete), keeping their ids. */
  async restore(rows: readonly PersistedListOrder[]): Promise<void> {
    if (rows.length === 0) return
    await db.listOrders.bulkPut([...rows])
  },

  /** Replaces the list's whole order with `writes` (tasks not in it become unranked). */
  async replaceList(listDefinitionId: number, writes: readonly RankWrite[]): Promise<void> {
    await db.transaction('rw', db.listOrders, async () => {
      await db.listOrders.where('listDefinitionId').equals(listDefinitionId).delete()
      if (writes.length > 0) {
        await db.listOrders.bulkAdd(writes.map((w): ListOrder => ({ listDefinitionId, todoId: w.todoId, rank: w.rank })))
      }
    })
  },
}
