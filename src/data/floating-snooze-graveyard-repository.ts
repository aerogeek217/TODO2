import { db } from './database'
import type { FloatingSnoozeGraveyard } from '../models'
import { createRepository } from './create-repository'

const base = createRepository<FloatingSnoozeGraveyard>(db.floatingSnoozeGraveyard)

export const floatingSnoozeGraveyardRepository = {
  ...base,

  async getByCanvas(canvasId: number): Promise<FloatingSnoozeGraveyard[]> {
    return db.floatingSnoozeGraveyard.where('canvasId').equals(canvasId).toArray()
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.floatingSnoozeGraveyard.update(id, { x, y })
  },

  async deleteByCanvas(canvasId: number): Promise<void> {
    await db.floatingSnoozeGraveyard.where('canvasId').equals(canvasId).delete()
  },
}
