import { db } from './database'
import type { SettingRow } from './database'

export const settingsRepository = {
  async getAll(): Promise<SettingRow[]> {
    return db.settings.toArray()
  },

  async put(key: string, value: string): Promise<void> {
    await db.settings.put({ key, value })
  },

  async delete(key: string): Promise<void> {
    await db.settings.delete(key)
  },

  async bulkDelete(keys: string[]): Promise<void> {
    await db.settings.bulkDelete(keys)
  },
}
