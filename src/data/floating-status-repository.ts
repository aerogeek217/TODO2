import { db } from './database'
import type { FloatingStatus } from '../models'
import { createRepository } from './create-repository'

const base = createRepository<FloatingStatus>(db.floatingStatus)

export const floatingStatusRepository = {
  ...base,

  async getByCanvas(canvasId: number): Promise<FloatingStatus[]> {
    return db.floatingStatus.where('canvasId').equals(canvasId).toArray()
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.floatingStatus.update(id, { x, y })
  },

  async deleteByCanvas(canvasId: number): Promise<void> {
    await db.floatingStatus.where('canvasId').equals(canvasId).delete()
  },
}
