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
}
