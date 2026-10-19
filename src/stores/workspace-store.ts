import { create } from 'zustand'
import { layoutRepository, type ReadLayout } from '../data/layout-repository'
import { readLayoutDraft, writeLayoutDraft, type LayoutDraftRecord } from '../data/draft-storage'
import { useUndoStore } from './undo-store'
import { useListDefinitionStore } from './list-definition-store'
import { registerModuleReset } from '../utils/module-reset'
import {
  LAYOUT_NAME_MAX,
  NEW_LAYOUT_NAME,
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
  layoutStructureEqual,
  layoutTabs,
  movePanel,
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
 * - `newLayout()` opens an empty `Untitled layout` that isn't stored until
 *   it's saved (`saved` is `null`, its id `UNSAVED_LAYOUT_ID`); discarding it
 *   goes back to the layout open before.
 */
export interface WorkspaceState {
  /** Saved layouts, oldest first (the picker's order). */
  layouts: Layout[]
  activeLayoutId: number | null
  /** The open layout as edited (`null` until `init`). */
  working: Layout | null
  /** The open layout as stored; `null` for a new layout not saved yet. */
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
  /** Opens a new, empty, unsaved layout (`Untitled layout`), dropping the working copy. */
  newLayout: () => void
  /**
   * Writes the working copy over the saved layout (a new layout: stores it
   * under its name and opens it). Resolves `false` when the
   * write failed — the layout stays unsaved and the snackbar says so; never
   * rejects (as `saveAs` → `null`, `rename` → `false`).
   */
  save: () => Promise<boolean>
  /**
   * Saves the working copy as a new layout and opens it; the layout it came
   * from stays as last saved. Returns the new id, or `null` for an empty name.
   */
  saveAs: (name: string) => Promise<number | null>
  /** Reverts the working copy to the saved layout; a new layout is dropped for the one open before. */
  discard: () => void
  /**
   * Renames a layout (not a layout change: never dirty). Empty name → `false`.
   * The new, unsaved layout (`UNSAVED_LAYOUT_ID`) is renamed in memory.
   */
  rename: (id: number, name: string) => Promise<boolean>
  /**
   * Deletes a layout — never the last one (`false`). Deleting the open layout
   * opens the most recently used remaining one.
   */
  delete: (id: number) => Promise<boolean>

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

/** Whether a kept new layout's lists are still the lists it showed (same ids, same names). */
function listsStillMatch(listNames: Readonly<Record<string, string>>, body: LayoutBody): boolean {
  const defs = useListDefinitionStore.getState().listDefinitions
  return listIdsOf(body).every((id) => {
    const def = defs.find((d) => d.id === id)
    return def != null && listNames[id] === def.name
  })
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
    const { working, saved } = get()
    if (!draft || !working || !saved) {
      keepDraft()
      return
    }
    if (draft.kind === 'saved') {
      if (draft.layoutId === saved.id && layoutStructureEqual(draft.base, saved)) {
        const next = withLayoutBody(working, draft.body)
        set({ working: next, isDirty: dirty(next, saved) })
      }
      keepDraft()
      return
    }
    await useListDefinitionStore.getState().ensureLoaded()
    // A newer open (a layout switch, a data replace) took over meanwhile.
    if (get().saved !== saved) return
    if (listsStillMatch(draft.listNames, draft.body)) {
      const now = new Date()
      set({
        working: { id: UNSAVED_LAYOUT_ID, name: draft.name, ...draft.body, createdAt: now, modifiedAt: now },
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

    newLayout() {
      const { activeLayoutId, previousLayoutId } = get()
      const now = new Date()
      set({
        working: { id: UNSAVED_LAYOUT_ID, name: NEW_LAYOUT_NAME, columns: [], createdAt: now, modifiedAt: now },
        saved: null,
        activeLayoutId: null,
        // A new layout over a new layout still goes back to the stored one.
        previousLayoutId: activeLayoutId ?? previousLayoutId,
        isDirty: true,
      })
      keepDraft()
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
      return true
    },

    async saveAs(name) {
      const clean = cleanName(name)
      const source = get().working
      if (!clean || !source) return null
      const now = new Date()
      const { id: _from, ...body } = source
      void _from
      const record = { ...body, name: clean, createdAt: now, modifiedAt: now, lastUsedAt: now }
      let id: number
      try {
        id = await layoutRepository.insert(record)
      } catch (err) {
        reportWriteFailure(`Couldn't save layout "${clean}".`, err)
        return null
      }
      await layoutRepository.setActiveId(id).catch((err: unknown) => {
        console.warn('[workspace] remembering the open layout failed', err)
      })
      const saved: Layout = { ...record, id }
      // Keep any edit made while the insert was in flight.
      const current = get().working ?? source
      const working: Layout = { ...current, id, name: clean, createdAt: now, modifiedAt: now, lastUsedAt: now }
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
      return id
    },

    discard() {
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
