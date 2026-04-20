import { db } from './database'
import type { FloatingTaskboard } from '../models'
import { createRepository } from './create-repository'

const base = createRepository<FloatingTaskboard>(db.floatingTaskboards)

export const floatingTaskboardRepository = {
  ...base,

  async getByCanvas(canvasId: number): Promise<FloatingTaskboard[]> {
    return db.floatingTaskboards.where('canvasId').equals(canvasId).toArray()
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.floatingTaskboards.update(id, { x, y })
  },

  async deleteByCanvas(canvasId: number): Promise<void> {
    await db.floatingTaskboards.where('canvasId').equals(canvasId).delete()
  },

  async deleteByTaskboard(taskboardId: number): Promise<void> {
    await db.floatingTaskboards.where('taskboardId').equals(taskboardId).delete()
  },
}
