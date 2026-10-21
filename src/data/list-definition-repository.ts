import { db } from './database'
import { createRepository, insertLast, nextSortOrder } from './create-repository'
import {
  EISENHOWER_LIST_NAME,
  findEisenhowerList,
  type ListDefinition,
  type PersistedListDefinition,
} from '../models/list-definition'
import { emptyPredicate } from '../models/filter-predicate'
import type { RankWrite } from '../utils/list-order'
import { pickPredicate } from './predicate-shape'
import { SETTING_KEYS } from './setting-keys'
import { formatEisenhowerSource, parseEisenhowerSource } from './eisenhower-shape'

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

  /**
   * Adds a copy of list `fromId` after the others (`def` — its parts as
   * copied, a name and an owner) with `fromId`'s manual order: the list and
   * its ranks in one transaction. Returns the new id, its sort order and
   * the ranks written.
   */
  async insertCopy(
    def: Omit<ListDefinition, 'id' | 'sortOrder'>,
    fromId: number,
  ): Promise<{ id: number; sortOrder: number; ranks: RankWrite[] }> {
    return db.transaction('rw', db.listDefinitions, db.listOrders, async () => {
      const sortOrder = await nextSortOrder(db.listDefinitions, -1)
      const id = await db.listDefinitions.add({ ...def, sortOrder })
      const from = await db.listOrders.where('listDefinitionId').equals(fromId).toArray()
      const ranks = from.map((r): RankWrite => ({ todoId: r.todoId, rank: r.rank }))
      if (ranks.length > 0) await db.listOrders.bulkAdd(ranks.map((r) => ({ listDefinitionId: id, ...r })))
      return { id, sortOrder, ranks }
    })
  },

  /**
   * The Eisenhower's own list (`owner: { eisenhower: true }`), made when
   * there is none: the one `eisenhowerSource` names when it is the
   * Eisenhower's, else the Eisenhower's list with the lowest id, else a new
   * list with no filter (`Eisenhower`, after the others) — and the setting
   * then names it. Returns its id. One transaction, so concurrent callers
   * make one list.
   */
  async ensureEisenhowerList(): Promise<number> {
    return db.transaction('rw', db.listDefinitions, db.settings, async () => {
      const stored = await db.settings.get(SETTING_KEYS.eisenhowerSource)
      const sourceId = stored ? parseEisenhowerSource(stored.value) : undefined
      const rows = (await db.listDefinitions.toArray()) as PersistedListDefinition[]
      let id = findEisenhowerList(rows, sourceId)?.id
      if (id === undefined) {
        const sortOrder = await nextSortOrder(db.listDefinitions, -1)
        id = await db.listDefinitions.add({
          name: EISENHOWER_LIST_NAME,
          sortOrder,
          membership: { kind: 'custom', predicate: emptyPredicate() },
          sort: 'manual',
          grouping: 'none',
          owner: { eisenhower: true },
        })
      }
      if (sourceId !== id) await db.settings.put({ key: SETTING_KEYS.eisenhowerSource, value: formatEisenhowerSource(id) })
      return id
    })
  },
}
