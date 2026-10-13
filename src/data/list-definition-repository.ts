import { db } from './database'
import { createRepository } from './create-repository'
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

  async reorder(orderedIds: number[]): Promise<void> {
    await db.transaction('rw', db.listDefinitions, async () => {
      for (let i = 0; i < orderedIds.length; i++) {
        const id = orderedIds[i]
        if (id == null) continue
        await db.listDefinitions.update(id, { sortOrder: i })
      }
    })
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
