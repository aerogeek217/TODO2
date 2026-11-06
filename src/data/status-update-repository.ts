import { db } from './database'
import type { PersistedStatusUpdate, StatusUpdate } from '../models/status-update'
import { createTaskChildRepository } from './task-child-repository'
import { touchTodos, type TaskTouch } from './touch-todos'

/**
 * A task's status updates (`statusUpdates`): dated lines of text, any
 * number per task — a task-owned table (`task-child-repository`: reads by
 * task, add / delete / restore, each write stamping its tasks'
 * `modifiedAt`), plus an entry's edit.
 */
export const statusUpdateRepository = Object.assign(createTaskChildRepository<StatusUpdate, PersistedStatusUpdate>(db.statusUpdates), {
  /**
   * Writes `changes` to one entry (only those fields). False when the entry
   * is gone (a write racing its delete doesn't bring it back).
   */
  async update(id: number, changes: Partial<Pick<StatusUpdate, 'date' | 'text'>>, touch?: TaskTouch): Promise<boolean> {
    return db.transaction('rw', [db.todos, db.statusUpdates], async () => {
      const row = await db.statusUpdates.get(id)
      if (!row) return false
      await db.statusUpdates.update(id, changes)
      await touchTodos([row], touch)
      return true
    })
  },
})
