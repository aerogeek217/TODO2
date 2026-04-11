import { db } from './database'
import type { StickyNote } from '../models'
import { createRepository } from './create-repository'

const base = createRepository<StickyNote>(db.stickyNotes)

export const stickyNoteRepository = {
  ...base,

  async getByCanvas(canvasId: number): Promise<StickyNote[]> {
    return db.stickyNotes.where('canvasId').equals(canvasId).toArray()
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.stickyNotes.update(id, { x, y })
  },

  async deleteByCanvas(canvasId: number): Promise<void> {
    await db.stickyNotes.where('canvasId').equals(canvasId).delete()
  },
}
