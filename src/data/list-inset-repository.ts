import { db } from './database'
import type { ListInset } from '../models'
import { createRepository } from './create-repository'

const base = createRepository<ListInset>(db.listInsets)

export const listInsetRepository = {
  ...base,

  async getByCanvas(canvasId: number): Promise<ListInset[]> {
    return db.listInsets.where('canvasId').equals(canvasId).toArray()
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.listInsets.update(id, { x, y })
  },

  async deleteByCanvas(canvasId: number): Promise<void> {
    await db.listInsets.where('canvasId').equals(canvasId).delete()
  },
}
