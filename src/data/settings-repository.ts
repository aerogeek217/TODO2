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

  /**
   * Writes several rows in one transaction — all or none: `value` a string
   * puts the row, `null` deletes it. For a setting stored as more than one
   * row (the tab badge ranges, a new list's sort and its direction), so a
   * failure never leaves half of it saved.
   */
  async writeMany(rows: Readonly<Record<string, string | null>>): Promise<void> {
    const entries = Object.entries(rows)
    if (entries.length === 0) return
    await db.transaction('rw', db.settings, async () => {
      for (const [key, value] of entries) {
        if (value === null) await db.settings.delete(key)
        else await db.settings.put({ key, value })
      }
    })
  },
}
