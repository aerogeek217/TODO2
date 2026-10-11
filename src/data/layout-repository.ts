import { db } from './database'
import { SETTING_KEYS } from './setting-keys'
import {
  DEFAULT_LAYOUT_NAME,
  type PersistedWorkspaceLayout,
  type WorkspaceLayout,
} from '../models/workspace-layout'

/** Picker order: oldest first. */
function byCreated(a: PersistedWorkspaceLayout, b: PersistedWorkspaceLayout): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
}

export const layoutRepository = {
  async getAll(): Promise<PersistedWorkspaceLayout[]> {
    const rows = (await db.layouts.toArray()) as PersistedWorkspaceLayout[]
    return rows.sort(byCreated)
  },

  async get(id: number): Promise<PersistedWorkspaceLayout | undefined> {
    return (await db.layouts.get(id)) as PersistedWorkspaceLayout | undefined
  },

  async insert(layout: Omit<WorkspaceLayout, 'id'>): Promise<number> {
    return db.layouts.add(layout as WorkspaceLayout)
  },

  async put(layout: PersistedWorkspaceLayout): Promise<void> {
    await db.layouts.put(layout)
  },

  /** Deletes a layout unless it is the last one. Returns whether it was deleted. */
  async deleteUnlessLast(id: number): Promise<boolean> {
    return db.transaction('rw', db.layouts, async () => {
      if ((await db.layouts.count()) <= 1) return false
      if (!(await db.layouts.get(id))) return false
      await db.layouts.delete(id)
      return true
    })
  },

  async getActiveId(): Promise<number | null> {
    const row = await db.settings.get(SETTING_KEYS.activeLayoutId)
    const n = row ? Number(row.value) : NaN
    return Number.isFinite(n) ? n : null
  },

  async setActiveId(id: number): Promise<void> {
    await db.settings.put({ key: SETTING_KEYS.activeLayoutId, value: String(id) })
  },

  /**
   * Creates an empty "Default" layout (and makes it active) when there is no
   * layout at all. Idempotent under concurrent callers: the check and the
   * insert share one read-write transaction, and IndexedDB runs overlapping
   * read-write transactions one after the other, so only the first caller
   * inserts.
   */
  async ensureDefault(): Promise<void> {
    await db.transaction('rw', db.layouts, db.settings, async () => {
      if ((await db.layouts.count()) > 0) return
      const now = new Date()
      const id = await db.layouts.add({ name: DEFAULT_LAYOUT_NAME, columns: [], createdAt: now, modifiedAt: now })
      await db.settings.put({ key: SETTING_KEYS.activeLayoutId, value: String(id) })
    })
  },
}
