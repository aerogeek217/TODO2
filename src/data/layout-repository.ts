import { db } from './database'
import { SETTING_KEYS } from './setting-keys'
import { rowFixes, sanitizeRow } from './import-validation'
import {
  DEFAULT_LAYOUT_NAME,
  createTab,
  layoutBodyOf,
  type PersistedWorkspaceLayout,
  type WorkspaceLayout,
} from '../models/workspace-layout'
import { isEisenhowerOwner, ownerLayoutId, type ListDefinition, type PersistedListDefinition } from '../models/list-definition'
import type { PersistedListOrder } from '../models/list-order'
import { repointLayoutLists } from '../utils/workspace-layout-ops'
import { nextSortOrder } from './create-repository'

/** The layout Settings › Data integrity's cleanup puts the lists that belong to no layout into. */
export const RECOVERED_LISTS_LAYOUT_NAME = 'Recovered lists'

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

/** A layout's list a new layout gets a copy of: the list it copies, and the copy as it is to be. */
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

/** What removing a layout's own lists did: the lists deleted, as they were (with their manual order), and the ones handed to another layout. */
export interface OwnedListsRemoved {
  deleted: number[]
  /** The deleted lists' rows and manual order, to bring them back (`restoreLists`). */
  rows: { defs: PersistedListDefinition[]; ranks: PersistedListOrder[] }
  /**
   * The lists another stored layout names (data a file or another build
   * wrote — the app never shows another layout's list): handed to the first
   * such layout, in the picker's order, instead of deleted under its tab.
   */
  handedOver: number[]
}

/**
 * The stored layout rows in the picker's order, read as stored (a row
 * another build wrote may lack a valid `sortOrder`: it goes last). Call
 * inside a transaction on `layouts`.
 */
async function storedLayoutsInOrder(): Promise<Array<Partial<WorkspaceLayout> & { id: number }>> {
  const layouts = (await db.layouts.toArray()) as Array<Partial<WorkspaceLayout> & { id: number }>
  const order = (l: Partial<WorkspaceLayout> & { id: number }) =>
    (typeof l.sortOrder === 'number' && Number.isFinite(l.sortOrder) ? l.sortOrder : Infinity)
  return layouts.sort((a, b) => order(a) - order(b) || a.id - b.id)
}

/**
 * Removes the lists of `ids`, which layout `from` owns: each one another
 * stored layout names is handed to that layout (`OwnedListsRemoved.handedOver`),
 * the others are deleted with their manual order. Inside a transaction on
 * `layouts` + `listDefinitions` + `listOrders`.
 */
async function removeLists(from: number, ids: readonly number[]): Promise<OwnedListsRemoved> {
  const handedOver: number[] = []
  const deleted: number[] = []
  const others = ids.length === 0
    ? []
    : (await storedLayoutsInOrder()).filter((l) => l.id !== from).map((l) => ({ id: l.id, names: storedListRefs(l) }))
  for (const id of ids) {
    const to = others.find((l) => l.names.has(id))?.id
    if (to == null) {
      deleted.push(id)
      continue
    }
    await db.listDefinitions.update(id, { owner: { layoutId: to } })
    handedOver.push(id)
  }
  const rows = await listRows(deleted)
  await deleteLists(deleted)
  return { deleted, rows, handedOver }
}

/** The rows and manual order of lists `ids`. Call inside a transaction on `listDefinitions` + `listOrders`. */
async function listRows(ids: readonly number[]): Promise<OwnedListsRemoved['rows']> {
  if (ids.length === 0) return { defs: [], ranks: [] }
  const defs = ((await db.listDefinitions.bulkGet([...ids])) as Array<PersistedListDefinition | undefined>).filter((d) => d != null)
  const ranks = (await db.listOrders.where('listDefinitionId').anyOf([...ids]).toArray()) as PersistedListOrder[]
  return { defs, ranks }
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
   * past the highest stored). Returns its id.
   */
  async insert(layout: Omit<WorkspaceLayout, 'id' | 'sortOrder'>): Promise<number> {
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
   * the lists it shows: each copy is a new list owned by the
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
   * order — only among `only` when given. One transaction.
   */
  async pruneOwnedLists(layoutId: number, shown: ReadonlySet<number>, only?: ReadonlySet<number>): Promise<OwnedListsRemoved> {
    return db.transaction('rw', db.layouts, db.listDefinitions, db.listOrders, async () => {
      const stored = storedListRefs(await db.layouts.get(layoutId))
      const ids = (await ownedListIds(layoutId)).filter((id) => !shown.has(id) && !stored.has(id) && (!only || only.has(id)))
      return removeLists(layoutId, ids)
    })
  },

  /**
   * Brings removed lists back (`OwnedListsRemoved.rows`) — each owned by the
   * layout it had, with their manual order —, in one transaction. Nothing is
   * brought back while one of their layouts is gone (no layout could show
   * them): returns whether they came back.
   */
  async restoreLists({ defs, ranks }: OwnedListsRemoved['rows']): Promise<boolean> {
    return db.transaction('rw', db.layouts, db.listDefinitions, db.listOrders, async () => {
      for (const def of defs) {
        const layoutId = ownerLayoutId(def)
        if (layoutId == null || !(await db.layouts.get(layoutId))) return false
      }
      for (const def of defs) await db.listDefinitions.put(def)
      if (ranks.length > 0) await db.listOrders.bulkPut(ranks)
      return true
    })
  },

  /**
   * Gives the lists of `ids` that belong to no stored layout (no owner, or
   * a layout that is gone — never the Eisenhower's) a layout, in one
   * transaction: each the first layout (in the picker's order) whose stored
   * row names it; the rest go, as list tabs in their list order, into a new
   * layout `RECOVERED_LISTS_LAYOUT_NAME` after the others. Returns how many
   * lists it gave a layout.
   */
  async adoptUnownedLists(ids: readonly number[]): Promise<number> {
    return db.transaction('rw', db.layouts, db.listDefinitions, async () => {
      const layouts = await storedLayoutsInOrder()
      const layoutIds = new Set(layouts.map((l) => l.id))
      const refs = layouts.map((l) => ({ id: l.id, names: storedListRefs(l) }))
      const rows = ((await db.listDefinitions.bulkGet([...ids])) as Array<PersistedListDefinition | undefined>)
        .filter((d): d is PersistedListDefinition => d != null && !isEisenhowerOwner(d.owner) && !layoutIds.has(ownerLayoutId(d) ?? NaN))
      const rest: PersistedListDefinition[] = []
      for (const def of rows) {
        const layoutId = refs.find((r) => r.names.has(def.id))?.id
        if (layoutId == null) rest.push(def)
        else await db.listDefinitions.put({ ...def, owner: { layoutId } })
      }
      if (rest.length > 0) {
        rest.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
        const tabs = rest.map((d, i) => createTab('lens', `tab-${i + 1}`, { listDefinitionId: d.id }))
        const now = new Date()
        const layoutId = await layoutRepository.insert({
          name: RECOVERED_LISTS_LAYOUT_NAME,
          columns: [{ id: 'col-1', weight: 1, cells: [{ id: 'cell-1', weight: 1, tabs, activeTabId: tabs[0]?.id }] }],
          createdAt: now,
          modifiedAt: now,
        })
        for (const def of rest) await db.listDefinitions.put({ ...def, owner: { layoutId } })
      }
      return rows.length
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
   * their manual order, in one transaction. `null` when nothing was deleted.
   */
  async deleteUnlessLast(id: number): Promise<OwnedListsRemoved | null> {
    return db.transaction('rw', db.layouts, db.listDefinitions, db.listOrders, async () => {
      if ((await db.layouts.count()) <= 1) return null
      if (!(await db.layouts.get(id))) return null
      await db.layouts.delete(id)
      return removeLists(id, await ownedListIds(id))
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
