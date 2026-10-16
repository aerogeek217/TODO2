import type { Table } from 'dexie'

/**
 * Factory for shared repository CRUD operations.
 * Returns base getAll, getById, insert, update, delete methods.
 * Extend per-repo for custom queries and cascade deletes.
 */
export function createRepository<T extends { id?: number }>(table: Table<T, number>, orderBy?: string) {
  return {
    async getAll(): Promise<T[]> {
      return orderBy ? table.orderBy(orderBy).toArray() : table.toArray()
    },

    async getById(id: number): Promise<T | undefined> {
      return table.get(id)
    },

    async insert(entity: Omit<T, 'id'>): Promise<number> {
      return table.add(entity as T)
    },

    async update(entity: T): Promise<void> {
      if (entity.id === undefined) {
        console.warn('update() called with undefined id, skipping')
        return
      }
      await table.put(entity)
    },

    async remove(id: number): Promise<void> {
      await table.delete(id)
    },
  }
}

/**
 * Gives each row in `orderedIds` its position as `sortOrder`, in one
 * transaction (a missing id is skipped).
 */
export async function reorderBySortOrder<T extends { id?: number; sortOrder: number }>(
  table: Table<T, number>,
  orderedIds: readonly number[],
): Promise<void> {
  await table.db.transaction('rw', table, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]
      if (id == null) continue
      await table.update(id, (row) => { row.sortOrder = i })
    }
  })
}
