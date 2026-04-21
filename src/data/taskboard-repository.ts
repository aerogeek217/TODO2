import { db } from './database'
import type { Taskboard, TaskboardEntry } from '../models'

/**
 * Singleton taskboard. The `taskboards` Dexie table always holds exactly one
 * row (legacy multi-row databases are coalesced by the v33 migration). Entries
 * live inline — every mutation reads the row, rewrites `entries` + `updatedAt`,
 * and writes it back.
 */
export const taskboardRepository = {
  /** Return the single taskboard row, or undefined if none exists yet. */
  async load(): Promise<Taskboard | undefined> {
    return db.taskboards.orderBy('id').first()
  },

  /** Return the single taskboard row, seeding an empty row on first call. */
  async ensureRow(): Promise<Taskboard> {
    const existing = await db.taskboards.orderBy('id').first()
    if (existing) return existing
    const now = new Date()
    const id = (await db.taskboards.add({
      entries: [],
      createdAt: now,
      updatedAt: now,
    } as Taskboard)) as number
    const row = await db.taskboards.get(id)
    if (!row) throw new Error('Failed to seed taskboard row')
    return row
  },

  async writeEntries(entries: TaskboardEntry[]): Promise<void> {
    const existing = await db.taskboards.orderBy('id').first()
    if (!existing?.id) {
      const now = new Date()
      await db.taskboards.add({
        entries,
        createdAt: now,
        updatedAt: now,
      } as Taskboard)
      return
    }
    await db.taskboards.update(existing.id, { entries, updatedAt: new Date() })
  },
}
