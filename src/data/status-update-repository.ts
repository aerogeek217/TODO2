import { db } from './database'
import type { PersistedStatusUpdate, StatusUpdate } from '../models/status-update'

/**
 * A task's status updates (`statusUpdates`): dated lines of text, any
 * number per task. `todoRepository.delete` / `bulkDelete` delete a task's
 * entries with it (`getByTodos` first, to put them back on undo).
 */
export const statusUpdateRepository = {
  async getAll(): Promise<PersistedStatusUpdate[]> {
    return (await db.statusUpdates.toArray()) as PersistedStatusUpdate[]
  },

  async getByTodos(todoIds: readonly number[]): Promise<PersistedStatusUpdate[]> {
    if (todoIds.length === 0) return []
    return (await db.statusUpdates.where('todoId').anyOf([...todoIds]).toArray()) as PersistedStatusUpdate[]
  },

  /**
   * Adds entries in one transaction (all or none) — the ones whose task
   * exists (a write racing the task's delete leaves none behind). Returns
   * them with their new ids, in input order.
   */
  async addMany(rows: readonly StatusUpdate[]): Promise<PersistedStatusUpdate[]> {
    if (rows.length === 0) return []
    return db.transaction('rw', [db.todos, db.statusUpdates], async () => {
      const present = await presentTodoIds(rows)
      const kept = rows.filter((r) => present.has(r.todoId))
      if (kept.length === 0) return []
      const ids = await db.statusUpdates.bulkAdd([...kept], { allKeys: true }) as number[]
      return kept.flatMap((row, i) => {
        const id = ids.at(i)
        return id != null ? [{ ...row, id }] : []
      })
    })
  },

  /** `addMany` for one entry: it with its new id, or undefined when its task is gone. */
  async add(row: StatusUpdate): Promise<PersistedStatusUpdate | undefined> {
    const [added] = await statusUpdateRepository.addMany([row])
    return added
  },

  /**
   * Writes `changes` to one entry (only those fields). False when the entry
   * is gone (a write racing its delete doesn't bring it back).
   */
  async update(id: number, changes: Partial<Pick<StatusUpdate, 'date' | 'text'>>): Promise<boolean> {
    return (await db.statusUpdates.update(id, changes)) > 0
  },

  async delete(id: number): Promise<void> {
    await db.statusUpdates.delete(id)
  },

  /** Deletes several entries in one transaction (ids already gone are skipped). */
  async deleteMany(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return
    await db.statusUpdates.bulkDelete([...ids])
  },

  /**
   * Puts rows back as they were (undo of a delete, redo of an add), keeping
   * their ids — the rows whose task still exists (one deleted meanwhile gets
   * no entries back). Returns the rows put back.
   */
  async restore(rows: readonly PersistedStatusUpdate[]): Promise<PersistedStatusUpdate[]> {
    if (rows.length === 0) return []
    return db.transaction('rw', [db.todos, db.statusUpdates], async () => {
      const present = await presentTodoIds(rows)
      const kept = rows.filter((r) => present.has(r.todoId))
      if (kept.length > 0) await db.statusUpdates.bulkPut(kept)
      return kept
    })
  },
}

/** The ids among `rows`' tasks that exist (read inside the caller's transaction). */
async function presentTodoIds(rows: readonly StatusUpdate[]): Promise<Set<number>> {
  const todoIds = [...new Set(rows.map((r) => r.todoId))]
  return new Set((await db.todos.bulkGet(todoIds)).flatMap((t) => (t?.id != null ? [t.id] : [])))
}
