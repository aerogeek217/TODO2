import { db } from './database'
import type { SavedView, PersistedSavedView } from '../models'

export const savedViewRepository = {
  async getAll(): Promise<PersistedSavedView[]> {
    const rows = await db.savedViews.orderBy('sortOrder').toArray()
    return rows as PersistedSavedView[]
  },

  async add(view: SavedView): Promise<number> {
    return db.savedViews.add(view)
  },

  async update(id: number, changes: Partial<SavedView>): Promise<void> {
    await db.savedViews.update(id, changes)
  },

  async remove(id: number): Promise<void> {
    await db.savedViews.delete(id)
  },
}
