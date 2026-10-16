import { db } from './database'
import { SETTING_KEYS } from './setting-keys'
import { rowFixes, sanitizeRow } from './import-validation'
import {
  DEFAULT_LAYOUT_NAME,
  type PersistedWorkspaceLayout,
  type WorkspaceLayout,
} from '../models/workspace-layout'

/** A stored layout as the app opens it, and what was repaired on the way. */
export interface ReadLayout {
  layout: PersistedWorkspaceLayout
  /**
   * The parts this build can't use that were dropped or reset in memory, in
   * words (`tab dropped`, `size reset`, …); empty for a valid row. The stored
   * row is left as it is: saving the layout (or Settings › Data integrity's
   * cleanup) writes the repair.
   */
  fixes: string[]
}

/**
 * A stored row through the layout repair the import and the audit use
 * (`pickLayoutColumns` via the `layouts` picker): an unknown widget kind, a
 * bad or repeated id, a bad size or tab setting is dropped or reset, so the
 * workspace never renders data this build can't. A layout can come out with
 * no columns (the workspace then shows its empty-layout tiles); it is never
 * dropped.
 */
function readable(row: PersistedWorkspaceLayout): ReadLayout {
  const fixes = rowFixes('layouts', row)
  if (fixes.length === 0) return { layout: row, fixes }
  return { layout: { ...sanitizeRow('layouts', row), id: row.id } as PersistedWorkspaceLayout, fixes }
}

/** Picker order: oldest first. */
function byCreated(a: ReadLayout, b: ReadLayout): number {
  return a.layout.createdAt.getTime() - b.layout.createdAt.getTime() || a.layout.id - b.layout.id
}

export const layoutRepository = {
  /** Every layout, repaired for use (`ReadLayout`), oldest first. */
  async getAll(): Promise<ReadLayout[]> {
    const rows = (await db.layouts.toArray()) as PersistedWorkspaceLayout[]
    return rows.map(readable).sort(byCreated)
  },

  /** One layout, repaired for use (`ReadLayout`). */
  async get(id: number): Promise<ReadLayout | undefined> {
    const row = (await db.layouts.get(id)) as PersistedWorkspaceLayout | undefined
    return row ? readable(row) : undefined
  },

  async insert(layout: Omit<WorkspaceLayout, 'id'>): Promise<number> {
    return db.layouts.add(layout as WorkspaceLayout)
  },

  async put(layout: PersistedWorkspaceLayout): Promise<void> {
    await db.layouts.put(layout)
  },

  /** Records when the layout was last opened; nothing else in the row changes. */
  async touch(id: number, lastUsedAt: Date): Promise<void> {
    await db.layouts.update(id, { lastUsedAt })
  },

  /** Renames the layout; nothing else in the row changes. */
  async rename(id: number, name: string): Promise<void> {
    await db.layouts.update(id, { name })
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
