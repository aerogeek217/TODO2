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
import { parseCheckinTaskScope } from '../utils/checkin-settings'

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

/**
 * The list ids a stored layout row names, read from the row as stored (not
 * through the layout repair, which may drop a tab it can't use): every
 * whole-number `listDefinitionId` and `listTiles` entry anywhere in it.
 */
export function storedListRefs(row: unknown): Set<number> {
  const ids = new Set<number>()
  const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
  const seen = new Set<object>()
  const stack: unknown[] = [row]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === null || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      stack.push(...node)
      continue
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'listDefinitionId' && isId(value)) ids.add(value)
      else if (key === 'listTiles' && Array.isArray(value)) for (const v of value) if (isId(v)) ids.add(v)
      stack.push(value)
    }
  }
  return ids
}

/** What removing a layout's own lists did: the lists deleted, and those made saved lists (named elsewhere). */
export interface OwnedListsRemoved {
  deleted: number[]
  released: number[]
}

/**
 * The list ids named outside layout `layoutId`: by every other stored
 * layout row (`storedListRefs`) and the check-in scope. Call inside a
 * transaction on `layouts` + `settings`.
 */
async function listRefsOutside(layoutId: number): Promise<Set<number>> {
  const ids = new Set<number>()
  await db.layouts.each((row) => {
    if ((row as { id?: unknown }).id !== layoutId) for (const ref of storedListRefs(row)) ids.add(ref)
  })
  const scope = (await db.settings.get(SETTING_KEYS.checkinTaskScope))?.value
  const parsed = typeof scope === 'string' ? parseCheckinTaskScope(scope) : undefined
  if (parsed?.kind === 'list') ids.add(parsed.listDefinitionId)
  return ids
}

/** Clears the owner of lists (they become saved lists). Call inside a transaction on `listDefinitions`. */
async function releaseLists(ids: readonly number[]): Promise<void> {
  for (const id of ids) {
    await db.listDefinitions.where('id').equals(id).modify((d) => { delete (d as Partial<ListDefinition>).owner })
  }
}

/** Deletes the lists of `ids` (and their manual order), but makes those `elsewhere` names saved lists. Inside a transaction. */
async function removeOwnedLists(ids: readonly number[], elsewhere: ReadonlySet<number>): Promise<OwnedListsRemoved> {
  const released = ids.filter((id) => elsewhere.has(id))
  const deleted = ids.filter((id) => !elsewhere.has(id))
  await releaseLists(released)
  await deleteLists(deleted)
  return { deleted, released }
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
   * Deletes the lists `layoutId` owns that are neither in `shown` (the lists
   * the layout shows on screen — `layoutListRefs`) nor named by its stored
   * row as it is at the delete (`storedListRefs`: a part the layout repair
   * drops, or a save landed meanwhile, still counts), and their manual
   * order. Such a list something outside the layout names (another layout,
   * the check-in scope) is made a saved list instead. One transaction.
   */
  async pruneOwnedLists(layoutId: number, shown: ReadonlySet<number>): Promise<OwnedListsRemoved> {
    return db.transaction('rw', db.layouts, db.listDefinitions, db.listOrders, db.settings, async () => {
      const stored = storedListRefs(await db.layouts.get(layoutId))
      const ids = (await ownedListIds(layoutId)).filter((id) => !shown.has(id) && !stored.has(id))
      return removeOwnedLists(ids, await listRefsOutside(layoutId))
    })
  },

  /**
   * Makes the lists of `ids` that layout `layoutId` owns saved lists (their
   * owner cleared), in one transaction. Returns the ids it changed.
   */
  async releaseOwnedLists(layoutId: number, ids: ReadonlySet<number>): Promise<number[]> {
    if (ids.size === 0) return []
    return db.transaction('rw', db.listDefinitions, async () => {
      const released = (await ownedListIds(layoutId)).filter((id) => ids.has(id))
      await releaseLists(released)
      return released
    })
  },

  /**
   * Whether list `listId` may become layout `layoutId`'s own list again
   * (an undone "Save to my lists"): `'gone'` when there is no such layout,
   * `'elsewhere'` when another layout or the check-in scope names the list,
   * else `null`.
   */
  async ownerBlocker(layoutId: number, listId: number): Promise<'gone' | 'elsewhere' | null> {
    return db.transaction('r', db.layouts, db.settings, async () => {
      if (!(await db.layouts.get(layoutId))) return 'gone'
      return (await listRefsOutside(layoutId)).has(listId) ? 'elsewhere' : null
    })
  },

  /** The list ids layout `id`'s stored row names (`storedListRefs`), unrepaired. */
  async storedListRefs(id: number): Promise<Set<number>> {
    return storedListRefs(await db.layouts.get(id))
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
   * their manual order, in one transaction — a list it owns that something
   * else names (another layout, the check-in scope) is made a saved list
   * instead. `null` when nothing was deleted.
   */
  async deleteUnlessLast(id: number): Promise<OwnedListsRemoved | null> {
    return db.transaction('rw', db.layouts, db.listDefinitions, db.listOrders, db.settings, async () => {
      if ((await db.layouts.count()) <= 1) return null
      if (!(await db.layouts.get(id))) return null
      await db.layouts.delete(id)
      return removeOwnedLists(await ownedListIds(id), await listRefsOutside(id))
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
