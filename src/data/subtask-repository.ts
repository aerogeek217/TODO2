import { db } from './database'
import type { PersistedSubtask, Subtask } from '../models/subtask'
import { presentTodoIds, touchTodoIds, touchTodos } from './touch-todos'

/** The fields a subtask write may change. */
export type SubtaskChanges = Partial<Pick<Subtask, 'title' | 'isCompleted' | 'sortOrder' | 'todoId'>>

/** One row's changes (`updateMany`). */
export interface SubtaskPatch {
  id: number
  changes: SubtaskChanges
}

/**
 * A task's checklist (`subtasks`): its subtasks, any number per task.
 * `todoRepository.delete` / `bulkDelete` delete a task's subtasks with it
 * (`getByTodos` first, to put them back on undo).
 *
 * A subtask write is activity on its task: given `touchedAt`, a write stamps
 * the `modifiedAt` of every task whose checklist it changed (a move to
 * another task: both), in the same transaction (`touch-todos`).
 */
export const subtaskRepository = {
  async getAll(): Promise<PersistedSubtask[]> {
    return (await db.subtasks.toArray()) as PersistedSubtask[]
  },

  async getByTodos(todoIds: readonly number[]): Promise<PersistedSubtask[]> {
    if (todoIds.length === 0) return []
    return (await db.subtasks.where('todoId').anyOf([...todoIds]).toArray()) as PersistedSubtask[]
  },

  /**
   * Adds subtasks in one transaction (all or none) — the ones whose task
   * exists (a write racing the task's delete leaves none behind). Returns
   * them with their new ids, in input order.
   */
  async addMany(rows: readonly Subtask[], touchedAt?: Date): Promise<PersistedSubtask[]> {
    if (rows.length === 0) return []
    return db.transaction('rw', [db.todos, db.subtasks], async () => {
      const present = await presentTodoIds(rows)
      const kept = rows.filter((r) => present.has(r.todoId))
      if (kept.length === 0) return []
      const ids = await db.subtasks.bulkAdd([...kept], { allKeys: true }) as number[]
      await touchTodos(kept, touchedAt)
      return kept.flatMap((row, i) => {
        const id = ids.at(i)
        return id != null ? [{ ...row, id }] : []
      })
    })
  },

  /** `addMany` for one subtask: it with its new id, or undefined when its task is gone. */
  async add(row: Subtask, touchedAt?: Date): Promise<PersistedSubtask | undefined> {
    const [added] = await subtaskRepository.addMany([row], touchedAt)
    return added
  },

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

  /** Deletes several subtasks in one transaction (ids already gone are skipped). */
  async deleteMany(ids: readonly number[], touchedAt?: Date): Promise<void> {
    if (ids.length === 0) return
    await db.transaction('rw', [db.todos, db.subtasks], async () => {
      const rows = (await db.subtasks.bulkGet([...ids])).flatMap((r) => (r ? [r] : []))
      await db.subtasks.bulkDelete([...ids])
      await touchTodos(rows, touchedAt)
    })
  },

  async delete(id: number, touchedAt?: Date): Promise<void> {
    await subtaskRepository.deleteMany([id], touchedAt)
  },

  /**
   * Puts rows back as they were (undo of a delete, redo of an add), keeping
   * their ids — the rows whose task still exists. Returns the rows put back.
   */
  async restore(rows: readonly PersistedSubtask[], touchedAt?: Date): Promise<PersistedSubtask[]> {
    if (rows.length === 0) return []
    return db.transaction('rw', [db.todos, db.subtasks], async () => {
      const present = await presentTodoIds(rows)
      const kept = rows.filter((r) => present.has(r.todoId))
      if (kept.length > 0) await db.subtasks.bulkPut(kept)
      await touchTodos(kept, touchedAt)
      return kept
    })
  },
}
