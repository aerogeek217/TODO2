import { db } from './database'
import { SETTING_KEYS } from './setting-keys'
import { rowFixes, sanitizeRow } from './import-validation'
import {
  DEFAULT_LAYOUT_NAME,
  layoutBodyOf,
  type PersistedWorkspaceLayout,
  type WorkspaceLayout,
} from '../models/workspace-layout'
import { ownerLayoutId, type ListDefinition, type PersistedListDefinition } from '../models/list-definition'
import { repointLayoutLists } from '../utils/workspace-layout-ops'
import { nextSortOrder } from './create-repository'

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
 * (`pickLayoutBody` via the `layouts` picker): an unknown widget kind, a
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

/** Picker order: by `sortOrder`, then oldest first. */
export function byLayoutOrder(a: PersistedWorkspaceLayout, b: PersistedWorkspaceLayout): number {
  return a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
}

/** The order a layout added now takes: one past the highest stored (0 for the first). Call inside the add's transaction. */
async function nextLayoutOrder(): Promise<number> {
  let next = 0
  await db.layouts.each((row) => {
    const order = (row as Partial<WorkspaceLayout>).sortOrder
    if (typeof order === 'number' && Number.isFinite(order)) next = Math.max(next, Math.floor(order) + 1)
  })
  return next
}

/** A layout-only list a new layout gets a copy of: the list it copies, and the copy as it is to be. */
export interface ListCopy {
  /** The list copied (its manual order is copied too). */
  from: number
  /** The copy's definition (its id, sort order and owner are given on insert). */
  def: Omit<ListDefinition, 'id' | 'sortOrder' | 'owner'>
}

/** The ids of the lists `layoutId` owns. Call inside a transaction on `listDefinitions`. */
async function ownedListIds(layoutId: number): Promise<number[]> {
  const rows = (await db.listDefinitions.toArray()) as PersistedListDefinition[]
  return rows.filter((d) => ownerLayoutId(d) === layoutId).map((d) => d.id)
}

/** Deletes lists and their manual order. Call inside a transaction on `listDefinitions` + `listOrders`. */
async function deleteLists(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return
  await db.listOrders.where('listDefinitionId').anyOf([...ids]).delete()
  await db.listDefinitions.bulkDelete([...ids])
}

export const layoutRepository = {
  /** Every layout, repaired for use (`ReadLayout`), in the picker's order. */
  async getAll(): Promise<ReadLayout[]> {
    const rows = (await db.layouts.toArray()) as PersistedWorkspaceLayout[]
    return rows.map(readable).sort((a, b) => byLayoutOrder(a.layout, b.layout))
  },

  /** One layout, repaired for use (`ReadLayout`). */
  async get(id: number): Promise<ReadLayout | undefined> {
    const row = (await db.layouts.get(id)) as PersistedWorkspaceLayout | undefined
    return row ? readable(row) : undefined
  },

  /**
   * Adds a layout after the others: its `sortOrder` is picked here (one
   * past the highest stored), whatever `layout` holds. Returns its id.
   */
  async insert(layout: Omit<WorkspaceLayout, 'id' | 'sortOrder'> & { sortOrder?: number }): Promise<number> {
    return db.transaction('rw', db.layouts, async () => {
      const sortOrder = await nextLayoutOrder()
      return db.layouts.add({ ...layout, sortOrder } as WorkspaceLayout)
    })
  },

  /**
   * Writes the layout. Its position stays as stored (only `insert` and
   * `reorder` set it), so a save never undoes a reorder made meanwhile.
   */
  async put(layout: PersistedWorkspaceLayout): Promise<void> {
    await db.transaction('rw', db.layouts, async () => {
      const stored = (await db.layouts.get(layout.id)) as Partial<WorkspaceLayout> | undefined
      const order = stored?.sortOrder
      const sortOrder = typeof order === 'number' && Number.isFinite(order) ? order : layout.sortOrder
      await db.layouts.put({ ...layout, sortOrder })
    })
  },

  /**
   * Adds a layout after the others (as `insert`) together with copies of
   * the layout-only lists it shows: each copy is a new list owned by the
   * new layout, with the manual order of the list it copies, and the new
   * layout's tabs show the copies instead. One transaction. Returns the
   * new layout's id and the copies' ids (copied id → copy's id).
   */
  async insertWithListCopies(
    layout: Omit<WorkspaceLayout, 'id' | 'sortOrder'>,
    copies: readonly ListCopy[],
  ): Promise<{ id: number; listIds: Map<number, number> }> {
    return db.transaction('rw', db.layouts, db.listDefinitions, db.listOrders, async () => {
      const id = await layoutRepository.insert(layout)
      const listIds = new Map<number, number>()
      for (const { from, def } of copies) {
        const sortOrder = await nextSortOrder(db.listDefinitions, -1)
        const copyId = await db.listDefinitions.add({ ...def, sortOrder, owner: { layoutId: id } })
        listIds.set(from, copyId)
        const ranks = await db.listOrders.where('listDefinitionId').equals(from).toArray()
        if (ranks.length > 0) {
          await db.listOrders.bulkAdd(ranks.map((r) => ({ listDefinitionId: copyId, todoId: r.todoId, rank: r.rank })))
        }
      }
      if (listIds.size > 0) {
        const row = (await db.layouts.get(id)) as PersistedWorkspaceLayout
        await db.layouts.put({ ...row, ...repointLayoutLists(layoutBodyOf(row), listIds) })
      }
      return { id, listIds }
    })
  },

  /**
   * Deletes the lists `layoutId` owns that are not in `shown` (the lists the
   * layout as saved now shows — `layoutListRefs`), and their manual order.
   * Returns their ids.
   */
  async pruneOwnedLists(layoutId: number, shown: ReadonlySet<number>): Promise<number[]> {
    return db.transaction('rw', db.listDefinitions, db.listOrders, async () => {
      const ids = (await ownedListIds(layoutId)).filter((id) => !shown.has(id))
      await deleteLists(ids)
      return ids
    })
  },

  /** Gives each layout of `orderedIds` its position as `sortOrder`, in one transaction (a missing id is skipped). */
  async reorder(orderedIds: readonly number[]): Promise<void> {
    await db.transaction('rw', db.layouts, async () => {
      for (const [i, id] of orderedIds.entries()) await db.layouts.update(id, { sortOrder: i })
    })
  },

  /** Records when the layout was last opened; nothing else in the row changes. */
  async touch(id: number, lastUsedAt: Date): Promise<void> {
    await db.layouts.update(id, { lastUsedAt })
  },

  /** Renames the layout; nothing else in the row changes. */
  async rename(id: number, name: string): Promise<void> {
    await db.layouts.update(id, { name })
  },

  /**
   * Deletes a layout unless it is the last one, with the lists it owns and
   * their manual order, in one transaction. Returns the deleted lists' ids,
   * or `null` when nothing was deleted.
   */
  async deleteUnlessLast(id: number): Promise<number[] | null> {
    return db.transaction('rw', db.layouts, db.listDefinitions, db.listOrders, async () => {
      if ((await db.layouts.count()) <= 1) return null
      if (!(await db.layouts.get(id))) return null
      await db.layouts.delete(id)
      const listIds = await ownedListIds(id)
      await deleteLists(listIds)
      return listIds
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
      const id = await db.layouts.add({ name: DEFAULT_LAYOUT_NAME, sortOrder: 0, columns: [], createdAt: now, modifiedAt: now })
      await db.settings.put({ key: SETTING_KEYS.activeLayoutId, value: String(id) })
    })
  },
}
