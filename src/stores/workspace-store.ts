import { create } from 'zustand'
import { byLayoutOrder, layoutRepository, type ListCopy, type OwnedListsRemoved, type ReadLayout } from '../data/layout-repository'
import { trackWrite } from './store-helpers'
import { readLayoutDraft, writeLayoutDraft, type LayoutDraftRecord } from '../data/draft-storage'
import { ownerLayoutId } from '../models/list-definition'
import { useUndoStore } from './undo-store'
import { undoable } from './undoable'
import { useListDefinitionStore } from './list-definition-store'
import { useListDraftStore } from './list-draft-store'
import { useListOrderStore } from './list-order-store'
import { registerModuleReset } from '../utils/module-reset'
import {
  LAYOUT_NAME_MAX,
  UNSAVED_LAYOUT_ID,
  createTab,
  layoutBodyOf,
  tabListId,
  withLayoutBody,
  type BandEdge,
  type LayoutBody,
  type PersistedWorkspaceLayout,
  type TabConfigOf,
  type TabSeed,
  type TabViewStateOf,
  type WidgetKind,
} from '../models/workspace-layout'
import {
  addTab,
  closeCell,
  closeTab,
  layoutIds,
  layoutListRefs,
  layoutStructureEqual,
  layoutTabs,
  listIdChanges,
  movePanel,
  repointLayoutLists,
  moveTab,
  patchTabConfig,
  patchTabViewState,
  replaceTab,
  setActiveTab,
  setBandHeight,
  setCellCollapsed,
  setCellWeights,
  setColumnWeights,
  splitCell,
  type IdGen,
  type LayoutDropTarget,
} from '../utils/workspace-layout-ops'

type Layout = PersistedWorkspaceLayout

/** A resize from a divider drag: `live` = one frame of it (see `setColumnWeights`). */
export interface ResizeOptions {
  live?: boolean
}

/**
 * Workspace layouts: the saved layouts plus an in-memory **working copy** of
 * the open one.
 *
 * - Structural edits (add / move / close / split / resize / band height /
 *   tab config) change
 *   only the working copy; `isDirty` says whether it differs from the saved
 *   layout. `save()` writes it, `discard()` drops it. An edited working copy
 *   is also kept in the browser (`data/draft-storage`, never the database),
 *   and the first `init()` of a page load opens it again, still unsaved —
 *   while the stored layout it was made against is unchanged.
 * - View state (active tab, collapsed cells and bands, a tab's `viewState`) is applied
 *   to the working copy **and** written straight onto the saved layout
 *   (last write wins) — it never makes the layout dirty.
 * - `load(id)` switches layouts unconditionally: callers ask the user about
 *   unsaved changes first.
 * - `createLayout(name)` stores a new, empty layout at once and opens it.
 *   Only an unsaved new layout an older build kept in the browser opens
 *   without being stored (`saved` is `null`, its id `UNSAVED_LAYOUT_ID`);
 *   discarding it goes back to the layout open before.
 */
export interface WorkspaceState {
  /** Saved layouts in the picker's order (`sortOrder`, then oldest first). */
  layouts: Layout[]
  activeLayoutId: number | null
  /** The open layout as edited (`null` until `init`). */
  working: Layout | null
  /** The open layout as stored; `null` for a kept new layout not saved yet. */
  saved: Layout | null
  /** While a new layout is open: the layout open before it, which Discard goes back to. */
  previousLayoutId: number | null
  /**
   * The working copy has structural changes that the stored layout doesn't:
   * edits since the last save, or a repair made when the layout was read.
   */
  isDirty: boolean
  /**
   * Layouts repaired when they were read (`ReadLayout.fixes`: a part this
   * build can't use dropped or reset) whose stored row still has those
   * parts. Saving the layout writes the repair; until then nothing writes the
   * whole layout back (view state stays in memory).
   */
  repairedIds: ReadonlySet<number>
  hydrated: boolean

  /**
   * Opens the active layout (creating an empty "Default" one when none
   * exists). Safe to call more than once or concurrently; any unsaved working
   * copy is dropped. Call after app startup has loaded the sync file.
   */
  init: () => Promise<void>
  /** Opens a layout, dropping the working copy. Unknown id → no-op. */
  load: (id: number) => Promise<void>
  /**
   * Stores a new, empty layout named `name` (after the others) and opens
   * it, dropping the working copy: callers ask about unsaved changes first.
   * Resolves its id, or `null` for an empty name or a failed write (the
   * snackbar says so).
   */
  createLayout: (name: string) => Promise<number | null>
  /**
   * Writes the working copy over the saved layout (a kept new layout: stores
   * it under its name and opens it). Resolves `false` when the
   * write failed — the layout stays unsaved and the snackbar says so; never
   * rejects (as `saveAs` → `null`, `rename` → `false`). Once saved, the
   * lists it owns that no tab of it shows any more are deleted
   * (with their manual order and unsaved edits); Discard keeps them.
   */
  save: () => Promise<boolean>
  /**
   * Saves the working copy as a new layout and opens it; the layout it came
   * from stays as last saved. The lists it shows are copied for
   * the new layout (as edited, with their manual order) and its tabs show
   * the copies; originals that only its edits showed go. Returns the new
   * id, or `null` for an empty name.
   */
  saveAs: (name: string) => Promise<number | null>
  /**
   * Reverts the working copy to the saved layout; a new layout is dropped
   * for the one open before. Resolves once the lists only the
   * dropped edits showed are deleted, as on Save.
   */
  discard: () => Promise<void>
  /**
   * Renames a layout (not a layout change: never dirty). Empty name → `false`.
   * A kept new layout not saved yet (`UNSAVED_LAYOUT_ID`) is renamed in memory.
   */
  rename: (id: number, name: string) => Promise<boolean>
  /**
   * Deletes a layout — never the last one (`false`). Deleting the open layout
   * opens the most recently used remaining one. The lists it owns go with
   * it (their manual order and unsaved edits too). Not undoable.
   */
  delete: (id: number) => Promise<boolean>
  /**
   * Puts the saved layouts in `orderedIds`' order (the tabs' and the
   * picker's), saved at once — not a layout change: nothing becomes
   * unsaved — as one undo step (`description`, default `Reordered layouts`).
   * Layouts it leaves out keep their order after the named ones. Resolves
   * `false` when the write failed (the order on screen goes back; the
   * snackbar says so; no undo step).
   */
  reorderLayouts: (orderedIds: readonly number[], description?: string) => Promise<boolean>
  /** Moves one saved layout to position `toIndex` (`reorderLayouts`, undo step `Moved layout “<name>”`). */
  moveLayout: (id: number, toIndex: number) => Promise<boolean>

  /** Adds a new widget tab at `target`. Returns its id, or `null` when the target is unknown. */
  addWidget: (kind: WidgetKind, target: LayoutDropTarget, seed?: TabSeed) => string | null
  moveTab: (tabId: string, target: LayoutDropTarget) => void
  /** Moves a whole panel (a cell or a band, by id) with all its tabs. */
  movePanel: (panelId: string, target: LayoutDropTarget) => void
  closeTab: (tabId: string) => void
  /** Closes a panel (a cell or a band, by id) with all its tabs. */
  closeCell: (panelId: string) => void
  /** "Split right" / "Split below". Returns the new empty cell's id. */
  splitCell: (cellId: string, direction: 'right' | 'below') => string | null
  /**
   * Batched column resize (weights by column id). `live`: one frame of a
   * divider drag — not kept in the browser until `keepLayoutDraft` (the drag's end).
   */
  setColumnWeights: (weightById: Readonly<Record<string, number>>, opts?: ResizeOptions) => void
  /** Batched cell resize (weights by cell id); `live` as for columns. */
  setCellWeights: (weightById: Readonly<Record<string, number>>, opts?: ResizeOptions) => void
  /** A band's height (px): layout structure, so the layout becomes unsaved; `live` as for columns. */
  setBandHeight: (edge: BandEdge, height: number, opts?: ResizeOptions) => void
  /** Keeps the open layout's edits in the browser now (the end of a live resize). */
  keepLayoutDraft: () => void
  /** Layout config of a tab (e.g. a lens tab's list, a calendar's date types). */
  patchTabConfig: <K extends WidgetKind>(tabId: string, kind: K, patch: Partial<TabConfigOf<K>>) => void
  /** "Change widget": swaps the tab's kind in place, with the new kind's defaults. */
  changeTabKind: (tabId: string, kind: WidgetKind, seed?: TabSeed) => void

  /** View state: switch a cell's tab. */
  setActiveTab: (tabId: string) => Promise<void>
  /** View state: collapse / expand a panel (a cell or a band, by id). */
  setCellCollapsed: (panelId: string, collapsed: boolean) => Promise<void>
  /** View state of a tab (e.g. a calendar's view / offset). */
  patchTabViewState: <K extends WidgetKind>(tabId: string, kind: K, patch: Partial<TabViewStateOf<K>>) => Promise<void>
}

function randomId(): string {
  return `w-${Math.random().toString(36).slice(2, 10)}`
}

/** Id generator that never returns an id already in `layout` (or one it handed out). */
function idGenFor(layout: Layout): IdGen {
  const used = layoutIds(layout)
  return () => {
    let id = randomId()
    while (used.has(id)) id = randomId()
    used.add(id)
    return id
  }
}

function cleanName(name: string): string | null {
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= LAYOUT_NAME_MAX ? trimmed : null
}

function replaceLayout(layouts: Layout[], layout: Layout): Layout[] {
  return layouts.map((l) => (l.id === layout.id ? layout : l))
}

/** The order a layout added after `layouts` takes (as `layoutRepository.insert` picks it). */
function orderAfter(layouts: readonly Layout[]): number {
  let next = 0
  for (const l of layouts) if (Number.isFinite(l.sortOrder)) next = Math.max(next, Math.floor(l.sortOrder) + 1)
  return next
}

/** Most recently opened (`lastUsedAt`, else `createdAt`); ties → picker order. */
function mostRecentlyUsed(layouts: Layout[]): Layout | undefined {
  let best: Layout | undefined
  let bestAt = -Infinity
  for (const l of layouts) {
    const at = (l.lastUsedAt ?? l.createdAt).getTime()
    if (at > bestAt) {
      best = l
      bestAt = at
    }
  }
  return best
}

/** Says (once per open) that a layout was repaired when it was read. */
function reportRepair(layout: Layout, fixes: readonly string[]): void {
  console.warn(`[workspace] layout "${layout.name}" repaired when read: ${fixes.join(', ')}`)
  useUndoStore.getState().notify(`Repaired layout "${layout.name}" — ${fixes.join(', ')}. Save it to keep the repair.`)
}

/** A layout write failed: logged, and the snackbar says what didn't happen. */
function reportWriteFailure(message: string, err: unknown): void {
  console.warn(`[workspace] ${message}`, err)
  useUndoStore.getState().notify(message)
}

/** The page load's first `init` while it runs (shared by concurrent callers). */
let firstInit: Promise<void> | null = null
registerModuleReset(() => { firstInit = null })

/**
 * The ids of the lists a layout's list tabs show (an Eisenhower tab's list
 * is an app-wide setting, not part of the layout).
 */
function listIdsOf(body: LayoutBody): number[] {
  const ids = new Set<number>()
  for (const tab of layoutTabs(body)) {
    const id = tabListId(tab, null)
    if (id != null) ids.add(id)
  }
  return [...ids]
}

/** What the browser keeps of the open layout: its edited working copy, else nothing. */
function draftRecord(working: Layout | null, saved: Layout | null): LayoutDraftRecord | null {
  if (!working) return null
  if (!saved) {
    const defs = useListDefinitionStore.getState().listDefinitions
    const listNames: Record<string, string> = {}
    for (const id of listIdsOf(working)) listNames[id] = defs.find((d) => d.id === id)?.name ?? ''
    return { kind: 'new', name: working.name, body: layoutBodyOf(working), listNames }
  }
  if (layoutStructureEqual(working, saved)) return null
  return { kind: 'saved', layoutId: saved.id, base: layoutBodyOf(saved), body: layoutBodyOf(working) }
}

/**
 * Whether a kept new layout can open again: it shows no list — every list
 * belongs to a stored layout (or the Eisenhower), so a layout not stored
 * yet can't show one.
 */
function showsNoList(body: LayoutBody): boolean {
  return listIdsOf(body).length === 0
}

/** Whether every list `body` names that still exists belongs to layout `layoutId` (a deleted one shows as such). */
function showsOnlyOwnLists(body: LayoutBody, layoutId: number): boolean {
  const defs = useListDefinitionStore.getState().listDefinitions
  return [...layoutListRefs(body)].every((id) => {
    const def = defs.find((d) => d.id === id)
    return def == null || ownerLayoutId(def) === layoutId
  })
}

/**
 * Lists deleted with their layout (or no longer shown by it when it was
 * saved): out of the list stores, their unsaved edits dropped.
 */
function forgetDeletedLists(ids: readonly number[]): void {
  if (ids.length === 0) return
  useListDefinitionStore.getState().forgetLists(ids)
  const drafts = useListDraftStore.getState()
  for (const id of ids) drafts.discard(id)
}

/** Takes a removal of a layout's lists into the stores: the deleted ones forgotten (`forgetDeletedLists`). */
function applyRemoved({ deleted }: OwnedListsRemoved): void {
  forgetDeletedLists(deleted)
}

/**
 * Deletes the lists layout `layoutId` owns that none of `bodies` (the
 * layout as now saved, and as edited since) shows, nor its stored row
 * (`layoutRepository.pruneOwnedLists`). A failed delete only leaves them in
 * place (hidden, unshown) until the layout is saved again.
 */
async function pruneOwnedLists(layoutId: number, ...bodies: LayoutBody[]): Promise<OwnedListsRemoved | null> {
  const shown = new Set(bodies.flatMap((b) => [...layoutListRefs(b)]))
  try {
    const removed = await trackWrite(() => layoutRepository.pruneOwnedLists(layoutId, shown))
    applyRemoved(removed)
    return removed
  } catch (err) {
    console.warn('[workspace] removing the layout\'s unshown lists failed', err)
    return null
  }
}

/**
 * The undo step (with the snackbar) for the lists a layout Save removed
 * from layout `layoutId`: Undo brings them back as its lists, with their
 * manual order (unless the layout is gone by then — it says so); Redo
 * removes them again unless the layout shows them by then.
 */
function recordRemovedLists(layoutId: number, removed: OwnedListsRemoved | null, shownNow: () => ReadonlySet<number>): void {
  const defs = removed?.rows.defs ?? []
  const [first] = defs
  if (!removed || !first) return
  const description = defs.length === 1
    ? `Removed the list “${first.name}”`
    : `Removed ${defs.length} lists`
  const ids = new Set(defs.map((d) => d.id))
  undoable(
    description,
    async () => {
      applyRemoved(await trackWrite(() => layoutRepository.pruneOwnedLists(layoutId, shownNow(), ids)))
    },
    async () => {
      const back = await trackWrite(() => layoutRepository.restoreLists(removed.rows))
      if (!back) {
        useUndoStore.getState().notify(defs.length === 1
          ? `“${first.name}” can’t come back: its layout is gone.`
          : 'The lists can’t come back: their layout is gone.')
        return
      }
      await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
    },
    true,
  )
}

/**
 * The lists of layout `layoutId` that `body` shows, as copies
 * for a new layout: each list as edited (its unsaved draft, else as saved;
 * a blank draft name keeps the saved name).
 */
function ownedListCopies(layoutId: number, body: LayoutBody): ListCopy[] {
  const shown = layoutListRefs(body)
  const drafts = useListDraftStore.getState().drafts
  const copies: ListCopy[] = []
  for (const saved of useListDefinitionStore.getState().listDefinitions) {
    if (!shown.has(saved.id) || ownerLayoutId(saved) !== layoutId) continue
    const { id: _id, sortOrder: _order, owner: _owner, ...def } = drafts[saved.id] ?? saved
    void _id
    void _order
    void _owner
    copies.push({ from: saved.id, def: { ...def, name: def.name.trim() || saved.name } })
  }
  return copies
}

/** The ids of the read layouts that were repaired. */
function repairedOf(reads: readonly ReadLayout[]): Set<number> {
  return new Set(reads.filter((r) => r.fixes.length > 0).map((r) => r.layout.id))
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** Keeps (or forgets) the open layout's edits in the browser, once the workspace is open. */
  function keepDraft(): void {
    const { hydrated, working, saved } = get()
    if (hydrated) writeLayoutDraft(draftRecord(working, saved))
  }

  /**
   * After the page load's first open: the kept draft of the open layout (or
   * of a new layout) when the stored data still matches what it was made
   * against; any other kept draft is forgotten.
   */
  async function reopenDraft(draft: LayoutDraftRecord | null): Promise<void> {
    await takeBackDraft(draft)
    // The edits a reload dropped (no kept draft, or one not taken back) may
    // have shown lists made for them: the ones neither the
    // stored layout nor the working copy shows go, as on Discard.
    // A kept draft of another layout than the open one is dropped too.
    const { working, saved, previousLayoutId, layouts } = get()
    const openId = saved?.id ?? previousLayoutId
    if (openId != null) await pruneOwnedLists(openId, ...(working && working.id === openId ? [working] : []))
    if (draft?.kind === 'saved' && draft.layoutId !== openId && layouts.some((l) => l.id === draft.layoutId)) {
      await pruneOwnedLists(draft.layoutId)
    }
  }

  async function takeBackDraft(draft: LayoutDraftRecord | null): Promise<void> {
    const { working, saved } = get()
    if (!draft || !working || !saved) {
      keepDraft()
      return
    }
    if (draft.kind === 'saved') {
      // Made before the layout got its own copies of lists it shared with
      // another layout (an upgrade): the same tabs show the copies now.
      const changes = draft.layoutId === saved.id ? listIdChanges(draft.base, saved) : null
      const base = changes && repointLayoutLists(draft.base, changes)
      if (changes && base && layoutStructureEqual(base, saved)) {
        const body = repointLayoutLists(draft.body, changes)
        await useListDefinitionStore.getState().ensureLoaded()
        // A newer open (a layout switch, a data replace) took over meanwhile.
        if (get().saved !== saved) return
        if (showsOnlyOwnLists(body, saved.id)) {
          const next = withLayoutBody(get().working ?? working, body)
          set({ working: next, isDirty: dirty(next, saved) })
        } else {
          useUndoStore.getState().notify(`Unsaved changes to layout “${saved.name}” were dropped: they showed another layout’s list.`)
        }
      }
      keepDraft()
      return
    }
    await useListDefinitionStore.getState().ensureLoaded()
    // A newer open (a layout switch, a data replace) took over meanwhile.
    if (get().saved !== saved) return
    if (!showsNoList(draft.body)) {
      useUndoStore.getState().notify(`The unsaved new layout “${draft.name}” was dropped: a layout shows only its own lists, and it wasn’t stored yet.`)
    } else {
      const now = new Date()
      set({
        working: { id: UNSAVED_LAYOUT_ID, name: draft.name, sortOrder: orderAfter(get().layouts), ...draft.body, createdAt: now, modifiedAt: now },
        saved: null,
        activeLayoutId: null,
        previousLayoutId: saved.id,
        isDirty: true,
      })
    }
    keepDraft()
  }

  /** Opens the active layout (`init`); `kept` = the kept draft to take back, on the first open. */
  async function openActive(kept: LayoutDraftRecord | null): Promise<void> {
    const first = !get().hydrated
    await layoutRepository.ensureDefault()
    const reads = await layoutRepository.getAll()
    const wanted = await layoutRepository.getActiveId()
    const layouts = reads.map((r) => r.layout)
    const active = layouts.find((l) => l.id === wanted) ?? mostRecentlyUsed(layouts)
    const read = reads.find((r) => r.layout === active)
    if (!read) return
    open(read, layouts, repairedOf(reads))
    if (first) await reopenDraft(kept)
  }

  /** The working copy differs from the stored layout (an edit, or a repair not saved yet). */
  function dirty(working: Layout, saved: Layout | null): boolean {
    return get().repairedIds.has(working.id) || !saved || !layoutStructureEqual(working, saved)
  }

  /**
   * Applies a structural edit to the working copy. Returns whether it
   * changed. A `live` edit (a frame of a divider drag) isn't kept in the
   * browser yet: the drag's end keeps the result once (`keepLayoutDraft`).
   */
  function edit(fn: (layout: Layout, genId: IdGen) => Layout, { live = false }: ResizeOptions = {}): boolean {
    const { working, saved } = get()
    if (!working) return false
    const next = fn(working, idGenFor(working))
    if (next === working) return false
    set({ working: next, isDirty: dirty(next, saved) })
    if (!live) keepDraft()
    return true
  }

  /**
   * Applies a view-state change to the working copy and persists it on the
   * saved layout — unless that layout was repaired when read and not saved
   * since: writing it would also write the repair, which only Save (or the
   * audit's cleanup) does. Its view state then lasts until a reload.
   */
  async function editView(fn: (layout: Layout) => Layout): Promise<void> {
    const { working, saved, layouts, repairedIds } = get()
    if (!working) return
    const nextWorking = fn(working)
    const nextSaved = saved ? fn(saved) : saved
    if (nextWorking === working && nextSaved === saved) return
    set({
      working: nextWorking,
      saved: nextSaved,
      ...(nextSaved && nextSaved !== saved ? { layouts: replaceLayout(layouts, nextSaved) } : {}),
    })
    keepDraft()
    if (nextSaved && nextSaved !== saved && !repairedIds.has(nextSaved.id)) {
      // View state is a convenience: a failed write keeps it for this session.
      await layoutRepository.put(nextSaved).catch((err: unknown) => {
        console.warn('[workspace] saving the view state failed', err)
      })
    }
  }

  /**
   * Opens a read layout as both working copy and saved layout. A layout
   * repaired when read opens unsaved, and the snackbar says what was repaired.
   */
  function open(read: ReadLayout, layouts: Layout[], repairedIds: ReadonlySet<number>): void {
    const { layout, fixes } = read
    set({
      layouts, repairedIds, activeLayoutId: layout.id, working: layout, saved: layout,
      isDirty: repairedIds.has(layout.id), hydrated: true, previousLayoutId: null,
    })
    if (fixes.length > 0) reportRepair(layout, fixes)
    keepDraft()
  }

  /**
   * Shows and saves the saved layouts in `orderedIds`' order (the others
   * after them). A failed write puts the order on screen back (`report`:
   * and says so in the snackbar). Resolves whether it was saved.
   */
  async function applyOrder(orderedIds: readonly number[], report = true): Promise<boolean> {
    const before = get().layouts
    const rank = new Map(orderedIds.map((id, i) => [id, i]))
    const ordered = [...before].sort((a, b) =>
      (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || byLayoutOrder(a, b))
    const ids = ordered.map((l) => l.id)
    const orderOf = new Map(ids.map((id, i) => [id, i]))
    const show = (orderById: ReadonlyMap<number, number>, layouts: Layout[]) => {
      const { working, saved } = get()
      const placed = (l: Layout): Layout => {
        const order = orderById.get(l.id)
        return order === undefined || order === l.sortOrder ? l : { ...l, sortOrder: order }
      }
      set({
        layouts,
        ...(saved ? { saved: placed(saved) } : {}),
        ...(working ? { working: placed(working) } : {}),
      })
    }
    show(orderOf, ordered.map((l) => ({ ...l, sortOrder: orderOf.get(l.id) ?? l.sortOrder })))
    try {
      await layoutRepository.reorder(ids)
      return true
    } catch (err) {
      show(new Map(before.map((l) => [l.id, l.sortOrder])), before)
      if (report) reportWriteFailure("Couldn't save the layout order.", err)
      else console.warn("[workspace] couldn't save the layout order", err)
      return false
    }
  }

  return {
    layouts: [],
    activeLayoutId: null,
    working: null,
    saved: null,
    previousLayoutId: null,
    isDirty: false,
    repairedIds: new Set(),
    hydrated: false,

    init() {
      if (get().hydrated) return openActive(null)
      // The page load's first open takes a kept draft back. Concurrent first
      // calls (StrictMode's double effects) share it, so the draft is read
      // once, before any open rewrites it.
      firstInit ??= openActive(readLayoutDraft()).finally(() => { firstInit = null })
      return firstInit
    },

    async load(id) {
      const read = await layoutRepository.get(id)
      if (!read) return
      const now = new Date()
      const layout: Layout = { ...read.layout, lastUsedAt: now }
      // Only the last-used time: the rest of the row stays as stored.
      await layoutRepository.touch(id, now)
      await layoutRepository.setActiveId(id)
      const repairedIds = new Set(get().repairedIds)
      if (read.fixes.length > 0) repairedIds.add(id)
      else repairedIds.delete(id)
      open({ layout, fixes: read.fixes }, replaceLayout(get().layouts, layout), repairedIds)
    },

    async createLayout(name) {
      const clean = cleanName(name)
      if (!clean) return null
      const now = new Date()
      const record = { name: clean, columns: [], createdAt: now, modifiedAt: now, lastUsedAt: now }
      let id: number
      try {
        id = await layoutRepository.insert(record)
      } catch (err) {
        reportWriteFailure(`Couldn't create layout "${clean}".`, err)
        return null
      }
      await layoutRepository.setActiveId(id).catch((err: unknown) => {
        console.warn('[workspace] remembering the open layout failed', err)
      })
      // The order the insert gave it (after the others).
      const sortOrder = (await layoutRepository.get(id).catch(() => undefined))?.layout.sortOrder ?? orderAfter(get().layouts)
      const layout: Layout = { ...record, id, sortOrder }
      open({ layout, fixes: [] }, [...get().layouts.filter((l) => l.id !== id), layout], get().repairedIds)
      return id
    },

    async save() {
      const { working, saved: stored } = get()
      if (!working) return false
      if (!stored) return (await get().saveAs(working.name)) !== null
      const next: Layout = { ...working, modifiedAt: new Date() }
      // Saved only once the write has landed: a failed write leaves the
      // layout unsaved (and says so) rather than lost on the next reload.
      try {
        await layoutRepository.put(next)
      } catch (err) {
        reportWriteFailure(`Couldn't save layout "${next.name}".`, err)
        return false
      }
      const repaired = new Set(get().repairedIds)
      repaired.delete(next.id)
      // An edit made while the write ran stays in the working copy, unsaved.
      const current = get().working
      const kept = current && current !== working ? current : next
      set({
        working: kept,
        saved: next,
        isDirty: kept !== next && !layoutStructureEqual(kept, next),
        repairedIds: repaired,
        layouts: replaceLayout(get().layouts, next),
      })
      keepDraft()
      // Its lists that no saved tab shows any more go (a part the repair
      // dropped no longer counts once saved) — unless an edit made meanwhile
      // shows one again — as an undo step.
      recordRemovedLists(next.id, await pruneOwnedLists(next.id, next, kept), () => {
        const current = get().working
        return current ? layoutListRefs(current) : new Set<number>()
      })
      return true
    },

    async saveAs(name) {
      const clean = cleanName(name)
      const source = get().working
      const from = get().saved
      if (!clean || !source) return null
      const now = new Date()
      const { id: _from, sortOrder: _order, ...body } = source
      void _from
      void _order
      // The lists it shows are copied for the new layout (as edited); the
      // originals stay with the layout they came from.
      if (from) await useListDefinitionStore.getState().ensureLoaded()
      const copies = from ? ownedListCopies(from.id, source) : []
      const original = { ...body, name: clean, createdAt: now, modifiedAt: now, lastUsedAt: now }
      let id: number
      let listIds: ReadonlyMap<number, number>
      try {
        ({ id, listIds } = await layoutRepository.insertWithListCopies(original, copies))
      } catch (err) {
        reportWriteFailure(`Couldn't save layout "${clean}".`, err)
        return null
      }
      const record = repointLayoutLists(original, listIds)
      if (listIds.size > 0) {
        await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
      }
      await layoutRepository.setActiveId(id).catch((err: unknown) => {
        console.warn('[workspace] remembering the open layout failed', err)
      })
      // The order the insert gave it (after the others).
      const sortOrder = (await layoutRepository.get(id).catch(() => undefined))?.layout.sortOrder ?? orderAfter(get().layouts)
      const saved: Layout = { ...record, id, sortOrder }
      // Keep any edit made while the insert was in flight.
      const current = repointLayoutLists(get().working ?? source, listIds)
      const working: Layout = { ...current, id, sortOrder, name: clean, createdAt: now, modifiedAt: now, lastUsedAt: now }
      set({
        layouts: [...get().layouts, saved],
        activeLayoutId: id,
        working,
        saved,
        isDirty: !layoutStructureEqual(working, saved),
        hydrated: true,
        previousLayoutId: null,
      })
      keepDraft()
      // The layout it came from stays as last saved: its lists only the
      // edits showed (now copied) go.
      if (from) await pruneOwnedLists(from.id, from)
      return id
    },

    async discard() {
      const { saved, working, layouts, previousLayoutId, repairedIds } = get()
      if (!saved) {
        if (!working) return
        // A new layout: back to the layout open before it.
        const previous = layouts.find((l) => l.id === previousLayoutId) ?? mostRecentlyUsed(layouts)
        if (!previous) return
        set({
          working: previous, saved: previous, activeLayoutId: previous.id,
          isDirty: repairedIds.has(previous.id), previousLayoutId: null,
        })
        keepDraft()
        return
      }
      set({ working: saved, isDirty: repairedIds.has(saved.id) })
      keepDraft()
      // Its lists only the dropped edits showed (made for them) go; the
      // ones the stored layout shows stay.
      await pruneOwnedLists(saved.id, saved)
    },

    async rename(id, name) {
      const clean = cleanName(name)
      if (!clean) return false
      const current = get().working
      if (id === UNSAVED_LAYOUT_ID) {
        if (!current || get().saved) return false
        set({ working: { ...current, name: clean } })
        keepDraft()
        return true
      }
      const read = await layoutRepository.get(id)
      if (!read) return false
      // Only the name: a layout repaired when read keeps its stored row.
      // Renamed on screen once the write has landed.
      try {
        await layoutRepository.rename(id, clean)
      } catch (err) {
        reportWriteFailure(`Couldn't rename layout "${read.layout.name}".`, err)
        return false
      }
      const { working, saved, layouts } = get()
      const nextSaved: Layout = saved?.id === id ? { ...saved, name: clean } : { ...read.layout, name: clean }
      set({
        layouts: replaceLayout(layouts, nextSaved),
        ...(saved?.id === id ? { saved: nextSaved } : {}),
        ...(working?.id === id ? { working: { ...get().working ?? working, name: clean } } : {}),
      })
      return true
    },

    async delete(id) {
      // Its lists go with it.
      const removed = await layoutRepository.deleteUnlessLast(id)
      if (!removed) return false
      const reads = await layoutRepository.getAll()
      const layouts = reads.map((r) => r.layout)
      const repairedIds = new Set([...get().repairedIds].filter((r) => r !== id))
      if (get().activeLayoutId !== id) {
        set({ layouts, repairedIds })
        applyRemoved(removed)
        return true
      }
      set({ repairedIds })
      const next = mostRecentlyUsed(layouts)
      if (next) await get().load(next.id)
      set({ layouts: get().layouts.filter((l) => l.id !== id) })
      applyRemoved(removed)
      return true
    },

    async reorderLayouts(orderedIds, description = 'Reordered layouts') {
      const before = get().layouts.map((l) => l.id)
      if (!(await applyOrder(orderedIds))) return false
      const after = get().layouts.map((l) => l.id)
      if (after.length === before.length && after.every((id, i) => id === before[i])) return true
      // Undo / redo throw on a failed write: the entry stays, to try again.
      const apply = (ids: readonly number[]) => async () => {
        if (!(await applyOrder(ids, false))) throw new Error('the layout order was not saved')
      }
      undoable(description, apply(after), apply(before), true)
      return true
    },

    moveLayout(id, toIndex) {
      const ids = get().layouts.map((l) => l.id)
      const from = ids.indexOf(id)
      const layout = get().layouts[from]
      if (!layout) return Promise.resolve(false)
      const to = Math.max(0, Math.min(ids.length - 1, toIndex))
      if (to === from) return Promise.resolve(true)
      ids.splice(from, 1)
      ids.splice(to, 0, id)
      return get().reorderLayouts(ids, `Moved layout “${layout.name}”`)
    },

    addWidget(kind, target, seed) {
      let tabId: string | null = null
      edit((layout, genId) => {
        const tab = createTab(kind, genId(), seed)
        const next = addTab(layout, tab, target, genId)
        if (next !== layout) tabId = tab.id
        return next
      })
      return tabId
    },

    moveTab(tabId, target) {
      edit((layout, genId) => moveTab(layout, tabId, target, genId))
    },

    movePanel(panelId, target) {
      edit((layout, genId) => movePanel(layout, panelId, target, genId))
    },

    closeTab(tabId) {
      edit((layout) => closeTab(layout, tabId))
    },

    closeCell(cellId) {
      edit((layout) => closeCell(layout, cellId))
    },

    splitCell(cellId, direction) {
      let newCellId: string | null = null
      edit((layout, genId) => {
        const result = splitCell(layout, cellId, direction, genId)
        newCellId = result.cellId
        return result.layout
      })
      return newCellId
    },

    setColumnWeights(weightById, opts) {
      edit((layout) => setColumnWeights(layout, weightById), opts)
    },

    setCellWeights(weightById, opts) {
      edit((layout) => setCellWeights(layout, weightById), opts)
    },

    setBandHeight(edge, height, opts) {
      edit((layout) => setBandHeight(layout, edge, height), opts)
    },

    keepLayoutDraft() {
      keepDraft()
    },

    patchTabConfig(tabId, kind, patch) {
      edit((layout) => patchTabConfig(layout, tabId, kind, patch))
    },

    changeTabKind(tabId, kind, seed) {
      edit((layout) => replaceTab(layout, tabId, createTab(kind, tabId, seed)))
    },

    setActiveTab(tabId) {
      return editView((layout) => setActiveTab(layout, tabId))
    },

    setCellCollapsed(cellId, collapsed) {
      return editView((layout) => setCellCollapsed(layout, cellId, collapsed))
    },

    patchTabViewState(tabId, kind, patch) {
      return editView((layout) => patchTabViewState(layout, tabId, kind, patch))
    },
  }
})
