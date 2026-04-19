import { db } from './database'
import type { FloatingNote } from '../models'
import { createRepository } from './create-repository'

const base = createRepository<FloatingNote>(db.floatingNotes)

export const floatingNoteRepository = {
  ...base,

  async getByCanvas(canvasId: number): Promise<FloatingNote[]> {
    return db.floatingNotes.where('canvasId').equals(canvasId).toArray()
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.floatingNotes.update(id, { x, y })
  },

  async deleteByCanvas(canvasId: number): Promise<void> {
    await db.floatingNotes.where('canvasId').equals(canvasId).delete()
  },
}
