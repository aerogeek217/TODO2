import { db } from './database'
import type { FloatingHorizons } from '../models'
import { createRepository } from './create-repository'

const base = createRepository<FloatingHorizons>(db.floatingHorizons)

export const floatingHorizonsRepository = {
  ...base,

  async getByCanvas(canvasId: number): Promise<FloatingHorizons[]> {
    return db.floatingHorizons.where('canvasId').equals(canvasId).toArray()
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.floatingHorizons.update(id, { x, y })
  },

  async deleteByCanvas(canvasId: number): Promise<void> {
    await db.floatingHorizons.where('canvasId').equals(canvasId).delete()
  },
}
