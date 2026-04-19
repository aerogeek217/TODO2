import { db } from './database'
import type { FloatingCalendar } from '../models'
import { createRepository } from './create-repository'

const base = createRepository<FloatingCalendar>(db.floatingCalendars)

export const floatingCalendarRepository = {
  ...base,

  async getByCanvas(canvasId: number): Promise<FloatingCalendar[]> {
    return db.floatingCalendars.where('canvasId').equals(canvasId).toArray()
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.floatingCalendars.update(id, { x, y })
  },

  async deleteByCanvas(canvasId: number): Promise<void> {
    await db.floatingCalendars.where('canvasId').equals(canvasId).delete()
  },
}
