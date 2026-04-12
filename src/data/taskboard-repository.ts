import { db } from './database'
import { createRepository } from './create-repository'
import type { TaskboardEntry } from '../models'

const base = createRepository<TaskboardEntry>(db.taskboardEntries, 'sortOrder')

export const taskboardRepository = {
  ...base,

  async getAll(): Promise<TaskboardEntry[]> {
    return db.taskboardEntries.orderBy('sortOrder').toArray()
  },

  async findByTodoId(todoId: number): Promise<TaskboardEntry | undefined> {
    return db.taskboardEntries.where('todoId').equals(todoId).first()
  },

  async addEntry(todoId: number): Promise<number> {
    const all = await db.taskboardEntries.orderBy('sortOrder').toArray()
    const maxSort = all.length > 0 ? all[all.length - 1].sortOrder : 0
    return db.taskboardEntries.add({ todoId, sortOrder: maxSort + 1000 })
  },

  async removeByTodoId(todoId: number): Promise<void> {
    await db.taskboardEntries.where('todoId').equals(todoId).delete()
  },

  async reorder(entries: Array<{ id: number; sortOrder: number }>): Promise<void> {
    await db.transaction('rw', db.taskboardEntries, async () => {
      for (const { id, sortOrder } of entries) {
        await db.taskboardEntries.update(id, { sortOrder })
      }
    })
  },
}
