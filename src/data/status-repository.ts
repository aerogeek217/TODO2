import { db } from './database'
import type { Status } from '../models'
import { createRepository } from './create-repository'

const base = createRepository<Status>(db.statuses, 'sortOrder')

export const statusRepository = {
  ...base,

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
    await db.transaction('rw', db.statuses, async () => {
      for (let i = 0; i < orderedIds.length; i++) {
        const id = orderedIds[i]
        if (id == null) continue
        await db.statuses.update(id, { sortOrder: i })
      }
    })
  },
}
