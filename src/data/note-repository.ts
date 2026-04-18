import { db } from './database'
import type { Note, PersistedNote } from '../models'

/**
 * Notes are a standalone table. Phase 3 uses a single sentinel note (id 1 when
 * seeded) for the dashboard Inbox; the schema supports multiple rows so a
 * future multi-note UI doesn't require migration.
 */
export const noteRepository = {
  async getAll(): Promise<PersistedNote[]> {
    return (await db.notes.orderBy('modifiedAt').toArray()) as PersistedNote[]
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

  async remove(id: number): Promise<void> {
    await db.notes.delete(id)
  },
}
