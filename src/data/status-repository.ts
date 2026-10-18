import { db } from './database'
import type { Status } from '../models'
import { createRepository, insertLast, reorderBySortOrder } from './create-repository'

const base = createRepository<Status>(db.statuses, 'sortOrder')

export const statusRepository = {
  ...base,

  /**
   * Adds a status after the others (sort order: one past the highest, at
   * least 1). Throws when a status already has its name (ignoring case) —
   * checked in the insert's transaction, so two adds of one name that start
   * together can't both pass.
   */
  async insertLast(status: Omit<Status, 'id' | 'sortOrder'>): Promise<{ id: number; sortOrder: number }> {
    return db.transaction('rw', db.statuses, async () => {
      const name = status.name.toLowerCase()
      if (await db.statuses.filter((s) => s.name.toLowerCase() === name).count() > 0) {
        throw new Error(`Status "${status.name}" already exists`)
      }
      return insertLast(db.statuses, status, 0)
    })
  },

  async delete(id: number): Promise<void> {
    await db.transaction('rw', [db.statuses, db.todos], async () => {
      await db.todos.where('statusId').equals(id).modify({ statusId: undefined })
      await db.statuses.delete(id)
    })
  },

  async getTodoCountForStatus(statusId: number): Promise<number> {
    return db.todos.where('statusId').equals(statusId).count()
  },

  async getTodoIdsForStatus(statusId: number): Promise<number[]> {
    return (await db.todos.where('statusId').equals(statusId).primaryKeys()) as number[]
  },

  /**
   * Undo-restore for `delete`: re-insert the status row (preserving its id) and
   * re-assign `statusId` on every todo that previously pointed to it. One
   * transaction so the file-storage debounce-save sees a single completed unit
   * of work rather than two interleaved batches.
   */
  async restoreWithTodos(status: Status, affectedTodoIds: number[]): Promise<void> {
    await db.transaction('rw', [db.statuses, db.todos], async () => {
      await db.statuses.add(status)
      for (const todoId of affectedTodoIds) {
        await db.todos.update(todoId, { statusId: status.id })
      }
    })
  },

  async reorder(orderedIds: number[]): Promise<void> {
    await reorderBySortOrder(db.statuses, orderedIds)
  },
}
