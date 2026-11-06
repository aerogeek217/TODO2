import { db } from './database'
import type { PersistedSubtask, Subtask } from '../models/subtask'
import { createTaskChildRepository } from './task-child-repository'
import { presentTodoIds, touchTodoIds } from './touch-todos'

/** The fields a subtask write may change. */
export type SubtaskChanges = Partial<Pick<Subtask, 'title' | 'isCompleted' | 'sortOrder' | 'todoId'>>

/** One row's changes (`updateMany`). */
export interface SubtaskPatch {
  id: number
  changes: SubtaskChanges
}

/**
 * A task's checklist (`subtasks`): its subtasks, any number per task — a
 * task-owned table (`task-child-repository`: reads by task, add / delete /
 * restore, each write stamping its tasks' `modifiedAt`), plus patches that
 * may move a subtask to another task (stamping both).
 */
export const subtaskRepository = Object.assign(createTaskChildRepository<Subtask, PersistedSubtask>(db.subtasks), {
  /**
   * Writes each patch's fields to its subtask in one transaction (a patch
   * whose row is gone is skipped: a write racing its delete doesn't bring it
   * back; one moving a subtask to a task that is gone is skipped too).
   * Stamps every task touched — a move stamps the one left and the one
   * joined. Returns how many rows were written.
   */
  async updateMany(patches: readonly SubtaskPatch[], touchedAt?: Date): Promise<number> {
    if (patches.length === 0) return 0
    return db.transaction('rw', [db.todos, db.subtasks], async () => {
      const rows = await db.subtasks.bulkGet(patches.map((p) => p.id))
      const targets = patches.flatMap((p) => p.changes.todoId != null ? [{ todoId: p.changes.todoId }] : [])
      const present = await presentTodoIds(targets)
      const touched = new Set<number>()
      let written = 0
      for (const [i, patch] of patches.entries()) {
        const row = rows[i]
        if (!row) continue
        if (patch.changes.todoId != null && !present.has(patch.changes.todoId)) continue
        await db.subtasks.update(patch.id, patch.changes)
        touched.add(row.todoId)
        if (patch.changes.todoId != null) touched.add(patch.changes.todoId)
        written++
      }
      await touchTodoIds(touched, touchedAt)
      return written
    })
  },

  /** `updateMany` for one subtask; false when it is gone. */
  async update(id: number, changes: SubtaskChanges, touchedAt?: Date): Promise<boolean> {
    return (await subtaskRepository.updateMany([{ id, changes }], touchedAt)) === 1
  },
})
