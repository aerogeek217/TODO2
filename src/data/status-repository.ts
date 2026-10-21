import { db } from './database'
import type { Status } from '../models'
import { createRepository, insertLast, reorderBySortOrder } from './create-repository'
import { todoRepository } from './todo-repository'

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

  /**
   * Deletes the status and clears it from its tasks — as any status edit
   * (`todoRepository.bulkUpdate`: one `modifiedAt`, a `status` event per
   * task) — in one transaction. Returns the tasks it was cleared from.
   */
  async delete(id: number, now: Date = new Date()): Promise<number[]> {
    return db.transaction('rw', [db.statuses, db.todos, db.todoEvents], async () => {
      const todoIds = (await db.todos.where('statusId').equals(id).primaryKeys()) as number[]
      await todoRepository.bulkUpdate(todoIds.map((todoId) => ({ todoId, changes: { statusId: undefined } })), now)
      await db.statuses.delete(id)
      return todoIds
    })
  },

  async getTodoCountForStatus(statusId: number): Promise<number> {
    return db.todos.where('statusId').equals(statusId).count()
  },

  /**
   * Undo-restore for `delete`: re-insert the status row (preserving its id) and
   * re-assign `statusId` on every todo that previously pointed to it (as
   * `delete`, through `todoRepository.bulkUpdate`). One
   * transaction so the file-storage debounce-save sees a single completed unit
   * of work rather than two interleaved batches.
   */
  async restoreWithTodos(status: Status, affectedTodoIds: number[], now: Date = new Date()): Promise<void> {
    await db.transaction('rw', [db.statuses, db.todos, db.todoEvents], async () => {
      await db.statuses.add(status)
      await todoRepository.bulkUpdate(affectedTodoIds.map((todoId) => ({ todoId, changes: { statusId: status.id } })), now)
    })
  },

  async reorder(orderedIds: number[]): Promise<void> {
    await reorderBySortOrder(db.statuses, orderedIds)
  },
}
