import { create } from 'zustand'
import { layoutRepository, type ReadLayout } from '../data/layout-repository'
import { useUndoStore } from './undo-store'
import {
  LAYOUT_NAME_MAX,
  createTab,
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
  layoutStructureEqual,
  moveTab,
  patchTabConfig,
  patchTabViewState,
  replaceTab,
  setActiveTab,
  setCellCollapsed,
  setCellWeights,
  setColumnWeights,
  splitCell,
  type IdGen,
  type LayoutDropTarget,
} from '../utils/workspace-layout-ops'

type Layout = PersistedWorkspaceLayout

/**
 * Workspace layouts: the saved layouts plus an in-memory **working copy** of
 * the open one.
 *
 * - Structural edits (add / move / close / split / resize / tab config) change
 *   only the working copy; `isDirty` says whether it differs from the saved
 *   layout. `save()` writes it, `discard()` drops it. Nothing persists the
 *   working copy across a reload.
 * - View state (active tab, collapsed cells, a tab's `viewState`) is applied
 *   to the working copy **and** written straight onto the saved layout
 *   (last write wins) — it never makes the layout dirty.
 * - `load(id)` switches layouts unconditionally: callers ask the user about
 *   unsaved changes first.
 */
export interface WorkspaceState {
  /** Saved layouts, oldest first (the picker's order). */
  layouts: Layout[]
  activeLayoutId: number | null
  /** The open layout as edited (`null` until `init`). */
  working: Layout | null
  /** The open layout as stored. */
  saved: Layout | null
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
  /** Writes the working copy over the saved layout. */
  save: () => Promise<void>
  /**
   * Saves the working copy as a new layout and opens it; the layout it came
   * from stays as last saved. Returns the new id, or `null` for an empty name.
   */
  saveAs: (name: string) => Promise<number | null>
  /** Reverts the working copy to the saved layout. */
  discard: () => void
  /** Renames a layout (not a layout change: never dirty). Empty name → `false`. */
  rename: (id: number, name: string) => Promise<boolean>
  /**
   * Deletes a layout — never the last one (`false`). Deleting the open layout
   * opens the most recently used remaining one.
   */
  delete: (id: number) => Promise<boolean>

  /** Adds a new widget tab at `target`. Returns its id, or `null` when the target is unknown. */
  addWidget: (kind: WidgetKind, target: LayoutDropTarget, seed?: TabSeed) => string | null
  moveTab: (tabId: string, target: LayoutDropTarget) => void
  closeTab: (tabId: string) => void
  closeCell: (cellId: string) => void
  /** "Split right" / "Split below". Returns the new empty cell's id. */
  splitCell: (cellId: string, direction: 'right' | 'below') => string | null
  /** Batched column resize (weights by column id). */
  setColumnWeights: (weightById: Readonly<Record<string, number>>) => void
  /** Batched cell resize (weights by cell id). */
  setCellWeights: (weightById: Readonly<Record<string, number>>) => void
  /** Layout config of a tab (e.g. a lens tab's list, a calendar's date types). */
  patchTabConfig: <K extends WidgetKind>(tabId: string, kind: K, patch: Partial<TabConfigOf<K>>) => void
  /** "Change widget": swaps the tab's kind in place, with the new kind's defaults. */
  changeTabKind: (tabId: string, kind: WidgetKind, seed?: TabSeed) => void

  /** View state: switch a cell's tab. */
  setActiveTab: (tabId: string) => Promise<void>
  /** View state: collapse / expand a cell. */
  setCellCollapsed: (cellId: string, collapsed: boolean) => Promise<void>
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

/** The ids of the read layouts that were repaired. */
function repairedOf(reads: readonly ReadLayout[]): Set<number> {
  return new Set(reads.filter((r) => r.fixes.length > 0).map((r) => r.layout.id))
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** The working copy differs from the stored layout (an edit, or a repair not saved yet). */
  function dirty(working: Layout, saved: Layout | null): boolean {
    return get().repairedIds.has(working.id) || !saved || !layoutStructureEqual(working.columns, saved.columns)
  }

  /** Applies a structural edit to the working copy. Returns whether it changed. */
  function edit(fn: (layout: Layout, genId: IdGen) => Layout): boolean {
    const { working, saved } = get()
    if (!working) return false
    const next = fn(working, idGenFor(working))
    if (next === working) return false
    set({ working: next, isDirty: dirty(next, saved) })
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
    if (nextSaved && nextSaved !== saved && !repairedIds.has(nextSaved.id)) await layoutRepository.put(nextSaved)
  }

  /**
   * Opens a read layout as both working copy and saved layout. A layout
   * repaired when read opens unsaved, and the snackbar says what was repaired.
   */
  function open(read: ReadLayout, layouts: Layout[], repairedIds: ReadonlySet<number>): void {
    const { layout, fixes } = read
    set({ layouts, repairedIds, activeLayoutId: layout.id, working: layout, saved: layout, isDirty: repairedIds.has(layout.id), hydrated: true })
    if (fixes.length > 0) reportRepair(layout, fixes)
  }

  return {
    layouts: [],
    activeLayoutId: null,
    working: null,
    saved: null,
    isDirty: false,
    repairedIds: new Set(),
    hydrated: false,

    async init() {
      await layoutRepository.ensureDefault()
      const reads = await layoutRepository.getAll()
      const wanted = await layoutRepository.getActiveId()
      const layouts = reads.map((r) => r.layout)
      const active = layouts.find((l) => l.id === wanted) ?? mostRecentlyUsed(layouts)
      const read = reads.find((r) => r.layout === active)
      if (!read) return
      open(read, layouts, repairedOf(reads))
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

    async save() {
      const { working, layouts, repairedIds } = get()
      if (!working) return
      const next: Layout = { ...working, modifiedAt: new Date() }
      const repaired = new Set(repairedIds)
      repaired.delete(next.id)
      set({ working: next, saved: next, isDirty: false, repairedIds: repaired, layouts: replaceLayout(layouts, next) })
      await layoutRepository.put(next)
    },

    async saveAs(name) {
      const clean = cleanName(name)
      const source = get().working
      if (!clean || !source) return null
      const now = new Date()
      const { id: _from, ...body } = source
      void _from
      const record = { ...body, name: clean, createdAt: now, modifiedAt: now, lastUsedAt: now }
      const id = await layoutRepository.insert(record)
      await layoutRepository.setActiveId(id)
      const saved: Layout = { ...record, id }
      // Keep any edit made while the insert was in flight.
      const current = get().working ?? source
      const working: Layout = { ...current, id, name: clean, createdAt: now, modifiedAt: now, lastUsedAt: now }
      set({
        layouts: [...get().layouts, saved],
        activeLayoutId: id,
        working,
        saved,
        isDirty: !layoutStructureEqual(working.columns, saved.columns),
        hydrated: true,
      })
      return id
    },

    discard() {
      const { saved } = get()
      if (!saved) return
      set({ working: saved, isDirty: get().repairedIds.has(saved.id) })
    },

    async rename(id, name) {
      const clean = cleanName(name)
      if (!clean) return false
      const read = await layoutRepository.get(id)
      if (!read) return false
      const { working, saved, layouts } = get()
      const nextSaved: Layout = saved?.id === id ? { ...saved, name: clean } : { ...read.layout, name: clean }
      set({
        layouts: replaceLayout(layouts, nextSaved),
        ...(saved?.id === id ? { saved: nextSaved } : {}),
        ...(working?.id === id ? { working: { ...working, name: clean } } : {}),
      })
      // Only the name: a layout repaired when read keeps its stored row.
      await layoutRepository.rename(id, clean)
      return true
    },

    async delete(id) {
      const deleted = await layoutRepository.deleteUnlessLast(id)
      if (!deleted) return false
      const reads = await layoutRepository.getAll()
      const layouts = reads.map((r) => r.layout)
      const repairedIds = new Set([...get().repairedIds].filter((r) => r !== id))
      if (get().activeLayoutId !== id) {
        set({ layouts, repairedIds })
        return true
      }
      set({ repairedIds })
      const next = mostRecentlyUsed(layouts)
      if (next) await get().load(next.id)
      set({ layouts: get().layouts.filter((l) => l.id !== id) })
      return true
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

    setColumnWeights(weightById) {
      edit((layout) => setColumnWeights(layout, weightById))
    },

    setCellWeights(weightById) {
      edit((layout) => setCellWeights(layout, weightById))
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
