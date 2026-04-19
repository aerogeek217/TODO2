import { db } from './database'
import type { Note, PersistedNote } from '../models'

/**
 * Notes table. Two shapes coexist:
 *   • Global notes — `canvasId` is null/undefined; backs the dashboard tile
 *     and rail Notes slot. A single sentinel row is seeded on first load.
 *   • Floating notes — `canvasId` is set; each row renders as a standalone
 *     node on its canvas (sticky-notes merge, Phase 5).
 */
export const noteRepository = {
  async getAll(): Promise<PersistedNote[]> {
    return (await db.notes.orderBy('modifiedAt').toArray()) as PersistedNote[]
  },

  async getGlobal(): Promise<PersistedNote[]> {
    const all = (await db.notes.toArray()) as PersistedNote[]
    return all.filter((n) => n.canvasId == null)
  },

  async getByCanvas(canvasId: number): Promise<PersistedNote[]> {
    return (await db.notes.where('canvasId').equals(canvasId).toArray()) as PersistedNote[]
  },

  async getById(id: number): Promise<PersistedNote | undefined> {
    return (await db.notes.get(id)) as PersistedNote | undefined
  },

  async add(note: Note): Promise<number> {
    return db.notes.add(note)
  },

  async update(note: PersistedNote): Promise<void> {
    await db.notes.put(note)
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.notes.update(id, { x, y })
  },

  async remove(id: number): Promise<void> {
    await db.notes.delete(id)
  },

  async deleteByCanvas(canvasId: number): Promise<void> {
    await db.notes.where('canvasId').equals(canvasId).delete()
  },
}
