import { db } from './database'
import { createRepository, insertLast, reorderBySortOrder } from './create-repository'
import type { ListDefinition, PersistedListDefinition } from '../models/list-definition'
import { pickPredicate } from './predicate-shape'

/**
 * The row with its predicate rebuilt from known keys (`pickPredicate`), so a
 * malformed stored filter (e.g. from a file imported before import checked
 * them) reads as no filter instead of crashing every list showing it. Only
 * the in-memory copy changes; the audit reports and fixes the stored row.
 */
function withSafePredicate(row: PersistedListDefinition): PersistedListDefinition {
  const membership = row.membership as { predicate?: unknown } | undefined
  return { ...row, membership: { kind: 'custom', predicate: pickPredicate(membership?.predicate).predicate } }
}

export const listDefinitionRepository = {
  ...createRepository<ListDefinition>(db.listDefinitions),

  async getAll(): Promise<PersistedListDefinition[]> {
    const rows = await db.listDefinitions.orderBy('sortOrder').toArray()
    return (rows as PersistedListDefinition[]).map(withSafePredicate)
  },

  /** Adds a list after the others (sort order: one past the highest, from 0). */
  async insertLast(def: Omit<ListDefinition, 'id' | 'sortOrder'>): Promise<{ id: number; sortOrder: number }> {
    return insertLast(db.listDefinitions, def, -1)
  },

  async reorder(orderedIds: number[]): Promise<void> {
    await reorderBySortOrder(db.listDefinitions, orderedIds)
  },

  /** Deletes the list and its manual order. */
  async remove(id: number): Promise<void> {
    await db.transaction('rw', db.listDefinitions, db.listOrders, async () => {
      await db.listOrders.where('listDefinitionId').equals(id).delete()
      await db.listDefinitions.delete(id)
    })
  },

  /**
   * Undo-restore for `remove`: re-insert the row preserving its original id so
   * any saved references (workspace list tabs, list orders) keep pointing at it.
   */
  async restore(def: PersistedListDefinition): Promise<void> {
    await db.listDefinitions.add(def)
  },
}
