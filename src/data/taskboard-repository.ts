import { db } from './database'
import type { Taskboard, TaskboardEntry } from '../models'

/**
 * CRUD over the `taskboards` table. Entries live inline on each row — every
 * entry-level mutation reads the board, rewrites `entries` + `updatedAt`, and
 * writes the whole row back. That keeps the model simple at the cost of
 * rewriting a small array per op; at the queue sizes we expect (tens) the
 * write is cheap and keeps the 1:1 store shape (one board = one row).
 */
export const taskboardRepository = {
  async getAll(): Promise<Taskboard[]> {
    return db.taskboards.orderBy('id').toArray()
  },

  async getById(id: number): Promise<Taskboard | undefined> {
    return db.taskboards.get(id)
  },

  async create(name: string): Promise<number> {
    const now = new Date()
    return db.taskboards.add({ name, entries: [], createdAt: now, updatedAt: now } as Taskboard)
  },

  async rename(id: number, name: string): Promise<void> {
    await db.taskboards.update(id, { name, updatedAt: new Date() })
  },

  async remove(id: number): Promise<void> {
    await db.taskboards.delete(id)
  },

  async writeEntries(id: number, entries: TaskboardEntry[]): Promise<void> {
    await db.taskboards.update(id, { entries, updatedAt: new Date() })
  },
}
