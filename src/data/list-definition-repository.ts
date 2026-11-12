import { db } from './database'
import { createRepository, insertLast } from './create-repository'
import type { ListDefinition, PersistedListDefinition } from '../models/list-definition'
import { pickPredicate } from './predicate-shape'

/**
 * The row with its predicate rebuilt from known keys (`pickPredicate`), so a
 * malformed stored filter (e.g. from a file imported before import checked
 * them) reads as no filter instead of crashing every list showing it. Only
 * the in-memory copy changes; the audit reports and fixes the stored row.
 * Its prompt keeps only its field (an older build stored a `label`, which no
 * UI reads; the next save of the list drops it).
 */
function withSafeShape(row: PersistedListDefinition): PersistedListDefinition {
  const membership = row.membership as { predicate?: unknown } | undefined
  return {
    ...row,
    membership: { kind: 'custom', predicate: pickPredicate(membership?.predicate).predicate },
    ...(row.runtimeFilter ? { runtimeFilter: { field: row.runtimeFilter.field } } : {}),
  }
}

export const listDefinitionRepository = {
  ...createRepository<ListDefinition>(db.listDefinitions),

  /** Every list the app reads, in list order. */
  async getAll(): Promise<PersistedListDefinition[]> {
    const rows = await db.listDefinitions.orderBy('sortOrder').toArray()
    return (rows as PersistedListDefinition[]).map(withSafeShape)
  },

  /** Adds a list after the others (sort order: one past the highest, from 0). */
  async insertLast(def: Omit<ListDefinition, 'id' | 'sortOrder'>): Promise<{ id: number; sortOrder: number }> {
    return insertLast(db.listDefinitions, def, -1)
  },
}
