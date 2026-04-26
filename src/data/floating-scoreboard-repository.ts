import { db } from './database'
import type { FloatingScoreboard } from '../models'
import { createRepository } from './create-repository'

const base = createRepository<FloatingScoreboard>(db.floatingScoreboard)

export const floatingScoreboardRepository = {
  ...base,

  async getByCanvas(canvasId: number): Promise<FloatingScoreboard[]> {
    return db.floatingScoreboard.where('canvasId').equals(canvasId).toArray()
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.floatingScoreboard.update(id, { x, y })
  },

  async deleteByCanvas(canvasId: number): Promise<void> {
    await db.floatingScoreboard.where('canvasId').equals(canvasId).delete()
  },
}
