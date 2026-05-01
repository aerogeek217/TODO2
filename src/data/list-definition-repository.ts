import { db } from './database'
import { createRepository } from './create-repository'
import type { ListDefinition, PersistedListDefinition } from '../models/list-definition'

export const listDefinitionRepository = {
  ...createRepository<ListDefinition>(db.listDefinitions),

  async getAll(): Promise<PersistedListDefinition[]> {
    const rows = await db.listDefinitions.orderBy('sortOrder').toArray()
    return rows as PersistedListDefinition[]
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

  /**
   * Undo-restore for `remove`: re-insert the row preserving its original id so
   * any saved references (canvas inset, dashboard pin) keep pointing at it.
   */
  async restore(def: PersistedListDefinition): Promise<void> {
    await db.listDefinitions.add(def)
  },
}
