import { db } from './database'
import type { Note, PersistedNote } from '../models'

/**
 * Notes table. Stores the single global "outside-tasks" note that every
 * notes widget shows.
 */
export const noteRepository = {
  async getAll(): Promise<PersistedNote[]> {
    return (await db.notes.orderBy('modifiedAt').toArray()) as PersistedNote[]
  },

  /**
   * The global notes, lowest id first; seeds an empty one when there is
   * none. Read and seed run in one transaction, so concurrent callers (two
   * notes widgets, two tabs) never seed two notes.
   */
  async getOrSeedGlobal(): Promise<PersistedNote[]> {
    return db.transaction('rw', db.notes, async () => {
      const rows = (await db.notes.toArray()) as PersistedNote[]
      if (rows.length > 0) return rows
      const now = new Date()
      const note = { content: '', createdAt: now, modifiedAt: now }
      const id = await db.notes.add(note)
      return [{ ...note, id }]
    })
  },

  /**
   * Writes a note's text (only `content` + `modifiedAt`). False when the
   * note no longer exists.
   */
  async saveContent(id: number, content: string, modifiedAt: Date): Promise<boolean> {
    return (await db.notes.update(id, { content, modifiedAt })) > 0
  },

  async getById(id: number): Promise<PersistedNote | undefined> {
    return (await db.notes.get(id)) as PersistedNote | undefined
  },

  async add(note: Note): Promise<number> {
    return db.notes.add(note)
  },

  async remove(id: number): Promise<void> {
    await db.notes.delete(id)
  },
}
