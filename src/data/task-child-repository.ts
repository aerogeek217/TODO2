import type { Table } from 'dexie'
import { db } from './database'
import { presentTodoIds, touchTodos } from './touch-todos'

/**
 * The repository of a table of rows that belong to one task each (status
 * updates, subtasks): reads by task, adds / deletes / restores in one
 * transaction each, and every write guarded against a task deleted
 * meanwhile (`presentTodoIds`). `todoRepository.delete` / `bulkDelete`
 * delete a task's rows with it (`getByTodos` first, to put them back on
 * undo).
 *
 * A write is activity on its task: given `touchedAt`, it stamps the
 * `modifiedAt` of every task whose rows it changed, in the same transaction
 * (`touch-todos`; so a task doesn't go stale while its rows come in).
 */
export interface TaskChildRepository<Row extends { todoId: number }, Stored extends Row & { id: number }> {
  getAll(): Promise<Stored[]>
  getByTodos(todoIds: readonly number[]): Promise<Stored[]>
  /**
   * Adds rows in one transaction (all or none) — the ones whose task exists
   * (a write racing the task's delete leaves none behind). Returns them with
   * their new ids, in input order.
   */
  addMany(rows: readonly Row[], touchedAt?: Date): Promise<Stored[]>
  /** `addMany` for one row: it with its new id, or undefined when its task is gone. */
  add(row: Row, touchedAt?: Date): Promise<Stored | undefined>
  /** Deletes several rows in one transaction (ids already gone are skipped). */
  deleteMany(ids: readonly number[], touchedAt?: Date): Promise<void>
  delete(id: number, touchedAt?: Date): Promise<void>
  /**
   * Puts rows back as they were (undo of a delete, redo of an add), keeping
   * their ids — the rows whose task still exists (one deleted meanwhile gets
   * none back). Returns the rows put back.
   */
  restore(rows: readonly Stored[], touchedAt?: Date): Promise<Stored[]>
}

/**
 * The shared part of a task-owned table's repository, over `table`. A table's
 * own methods are added to the object returned (`Object.assign`), so every
 * method calls its siblings through the one exported object.
 */
export function createTaskChildRepository<Row extends { todoId: number }, Stored extends Row & { id: number }>(
  table: Table<Row, number>,
): TaskChildRepository<Row, Stored> {
  /** Rows read back: each carries its auto-increment `id`. */
  const stored = (rows: Row[]): Stored[] => rows as unknown as Stored[]
  const repository: TaskChildRepository<Row, Stored> = {
    async getAll() {
      return stored(await table.toArray())
    },

    async getByTodos(todoIds) {
      if (todoIds.length === 0) return []
      return stored(await table.where('todoId').anyOf([...todoIds]).toArray())
    },

    async addMany(rows, touchedAt) {
      if (rows.length === 0) return []
      return db.transaction('rw', [db.todos, table], async () => {
        const present = await presentTodoIds(rows)
        const kept = rows.filter((r) => present.has(r.todoId))
        if (kept.length === 0) return []
        const ids = await table.bulkAdd([...kept], { allKeys: true }) as number[]
        await touchTodos(kept, touchedAt)
        return kept.flatMap((row, i) => {
          const id = ids.at(i)
          return id != null ? stored([{ ...row, id }]) : []
        })
      })
    },

    async add(row, touchedAt) {
      const [added] = await repository.addMany([row], touchedAt)
      return added
    },

    async deleteMany(ids, touchedAt) {
      if (ids.length === 0) return
      await db.transaction('rw', [db.todos, table], async () => {
        const rows = (await table.bulkGet([...ids])).flatMap((r) => (r ? [r] : []))
        await table.bulkDelete([...ids])
        await touchTodos(rows, touchedAt)
      })
    },

    async delete(id, touchedAt) {
      await repository.deleteMany([id], touchedAt)
    },

    async restore(rows, touchedAt) {
      if (rows.length === 0) return []
      return db.transaction('rw', [db.todos, table], async () => {
        const present = await presentTodoIds(rows)
        const kept = rows.filter((r) => present.has(r.todoId))
        if (kept.length > 0) await table.bulkPut([...kept])
        await touchTodos(kept, touchedAt)
        return kept
      })
    },
  }
  return repository
}
