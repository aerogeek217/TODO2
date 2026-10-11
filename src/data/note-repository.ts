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

  async getGlobal(): Promise<PersistedNote[]> {
    return (await db.notes.toArray()) as PersistedNote[]
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
