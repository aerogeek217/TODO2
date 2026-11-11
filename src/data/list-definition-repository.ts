import { db } from './database'
import { createRepository, insertLast } from './create-repository'
import {
  isRetiredEisenhowerOwner,
  type ListDefinition,
  type PersistedListDefinition,
} from '../models/list-definition'
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

  /**
   * Every list the app reads, in list order. The removed Eisenhower's hidden
   * list (`RetiredEisenhowerOwner`), which a database from before its
   * removal may still hold, is left out: it stays stored (and travels with
   * exports, backups and the sync file) until schema v79 deletes it.
   */
  async getAll(): Promise<PersistedListDefinition[]> {
    const rows = await db.listDefinitions.orderBy('sortOrder').toArray()
    return (rows as PersistedListDefinition[]).filter((d) => !isRetiredEisenhowerOwner(d.owner)).map(withSafeShape)
  },

  /** Adds a list after the others (sort order: one past the highest, from 0). */
  async insertLast(def: Omit<ListDefinition, 'id' | 'sortOrder'>): Promise<{ id: number; sortOrder: number }> {
    return insertLast(db.listDefinitions, def, -1)
  },
}
