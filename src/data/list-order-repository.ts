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

  /**
   * Puts rows back as they were (undo of a task delete), keeping their ids —
   * those whose list and task still exist (a list deleted with its layout
   * meanwhile gets no ranks back: they would be orphans). Returns the rows
   * put back.
   */
  async restore(rows: readonly PersistedListOrder[]): Promise<PersistedListOrder[]> {
    if (rows.length === 0) return []
    return db.transaction('rw', [db.listOrders, db.listDefinitions, db.todos], async () => {
      const listIds = [...new Set(rows.map((r) => r.listDefinitionId))]
      const todoIds = [...new Set(rows.map((r) => r.todoId))]
      const lists = new Set(await db.listDefinitions.where(':id').anyOf(listIds).primaryKeys())
      const todos = new Set(await db.todos.where(':id').anyOf(todoIds).primaryKeys())
      const kept = rows.filter((r) => lists.has(r.listDefinitionId) && todos.has(r.todoId))
      if (kept.length > 0) await db.listOrders.bulkPut(kept)
      return kept
    })
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
