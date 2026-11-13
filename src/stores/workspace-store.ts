import { create } from 'zustand'
import { byLayoutOrder, layoutRepository, type ListCopy, type OwnedListsRemoved, type ReadLayout } from '../data/layout-repository'
import { trackWrite } from './store-helpers'
import { clearLayoutDraft, readLayoutDraft, type LayoutDraftRecord } from '../data/draft-storage'
import { ownerLayoutId } from '../models/list-definition'
import { UndoGone, UndoRefused, useUndoStore, type UndoEntry } from './undo-store'
import { undoable } from './undoable'
import { editorsHoldChanges, leaveOpenEditors } from './editor-leave'
import { assertNoReplaceHold, refusedByReplaceHold, registerReplaceSettle, replaceHoldActive } from './replace-hold'
import { useListDefinitionStore } from './list-definition-store'
import { useListOrderStore } from './list-order-store'
import { useTagStore } from './tag-store'
import { useSettingsStore } from './settings-store'
import { CHART_NAME_MAX, defaultBreakdownColumns } from '../models/chart-widgets'
import { NUMBER_NAME_MAX, trendName } from '../models/glance-widgets'
import type { IconValue } from '../models/icon'
import { projectTagIds } from '../utils/neglect-map'
import { registerModuleReset, registerModuleSettle } from '../utils/module-reset'
import {
  LAYOUT_NAME_MAX,
  TAB_NAME_MAX,
  createTab,
  kindTabTitle,
  widgetKindLabel,
  emptyLayoutBody,
  layoutBodyOf,
  withLayoutBody,
  type GridAxis,
  type LayoutBody,
  type PersistedWorkspaceLayout,
  type TabConfigOf,
  type TabSeed,
  type TabViewStateOf,
  type WidgetKind,
  type WorkspaceLayout,
} from '../models/workspace-layout'
import { getTab, layoutIds, layoutStructureEqual } from '../utils/workspace-layout-queries'
import { layoutListRefs, listIdChanges, repointLayoutLists } from '../utils/workspace-layout-lists'
import { copySizes, setTrackSizes, trackAxes, withoutTrackFitPx } from '../utils/workspace-layout-sizes'
import { withViewStateOf } from '../utils/workspace-layout-view'
import {
  addTab,
  closeCell,
  closeTab,
  insertTrack,
  mergeCells,
  moveEdge,
  movePanel,
  moveTab,
  patchTabConfig,
  patchTabViewState,
  replaceTab,
  setActiveTab,
  setTrackCollapsed,
  setLayoutHue,
  setTabLabel,
  splitCell,
  withLabelOf,
  withTrackIdsOf,
  type IdGen,
  type LayoutDropTarget,
  type MoveEdgeOptions,
} from '../utils/workspace-layout-ops'
import type { EdgeStretch, Side } from '../utils/workspace-grid'
import { samePreviewBody } from '../utils/workspace-preview'

type Layout = PersistedWorkspaceLayout

function sameHandle(a: ResizeHandle, b: ResizeHandle): boolean {
  if (a.kind === 'divider') return b.kind === 'divider' && a.axis === b.axis && a.beforeId === b.beforeId && a.afterId === b.afterId
  return b.kind === 'crossing' && a.cornerId === b.cornerId && a.key === b.key
}

/** A resize from a divider: `live` = one frame of a drag (see `setTrackSizes`). */
export interface ResizeOptions {
  live?: boolean
}

/**
 * The resize handle a preview belongs to: a divider (its axis and the first
 * cells on either side, as it was keyed when the drag started) or a crossing
 * handle (its corner cell, above-left, and its key).
 */
export type ResizeHandle =
  | { kind: 'divider'; axis: GridAxis; beforeId: string; afterId: string }
  | { kind: 'crossing'; cornerId: string; key: string }

/**
 * A resize drag whose move changes the structure (part of a line moved, or a
 * line onto or past another): the table as its release will leave it
 * (`moveEdge`'s probe, throwaway track ids), drawn instead of the working
 * copy's grid while the drag runs (`utils/workspace-preview`).
 */
export interface ResizePreview {
  layoutId: number
  body: LayoutBody
  handle: ResizeHandle
}

/** What an undo step of a structural edit says to do with its undo / redo: a key that merges a run of steps into one. */
export interface EditUndoOptions {
  /** Steps passing the same key one after another stay one undo step (a divider stepped by the arrow keys). */
  mergeKey?: string
  /** No undo snackbar: the step is on the undo stack all the same (a divider moved — the table shows it). */
  quiet?: boolean
}

/**
 * Workspace layouts: the stored layouts and the open one. **Every edit is
 * saved at once** (layout autosave): nothing is ever unsaved.
 *
 * - Structural edits (add / move / close / split / merge / insert, a tab's
 *   config or kind, part of a grid line moved) commit at once: the open
 *   layout changes, its row is written (`layoutRepository.putAndPrune`) and
 *   the edit is one undo step with the snackbar, named in words
 *   (`Closed tab “This week”`). The lists the layout owns that it no longer
 *   shows (`layoutListRefs`: list tabs and Numbers that follow a list; a
 *   Review widget's picks are temporary and name none) are deleted in the
 *   same write. Undo brings those lists back
 *   first, then the layout's table as it was before the edit, carrying the
 *   view state of the moment it runs (`withViewStateOf`: sizes, collapse,
 *   active tabs, tabs' view state); Redo removes them again. Either runs
 *   only while that layout is open (else it says to open it and stays on
 *   the stack) and says so once the layout is gone. Steps given the same
 *   merge key one after another are one step (`EditUndoOptions`).
 * - View state (sizes — the tracks' weights and px —, active tab,
 *   collapsed row tracks, a tab's `viewState`) is written straight onto the
 *   stored layout (`layoutRepository.updateView`, last write wins) — never an
 *   undo step. A divider drag's frames (`live`) change only `working`, and
 *   its end writes them once.
 * - A write that fails leaves what is on screen and says so
 *   (`writeFailed`, the top bar's `Couldn't save · Retry`): the next write of
 *   the layout — any edit, or `retryWrite` — writes all of it. Leaving the
 *   layout (another layout, a new one) tries once more first and stays when
 *   that fails too.
 * - A layout repaired when it was read opens with its repair in memory; its
 *   first edit writes it (until then view state isn't written).
 * - The first `init()` of a page load applies an unsaved layout change a
 *   build before autosave kept in the browser, once (`data/draft-storage`):
 *   as one undo step while the stored layout is still the one it was made
 *   against, else dropped; a kept new layout becomes a stored one.
 * - `load(id)` switches layouts; `createLayout(name)` stores a new, empty
 *   layout at once and opens it.
 * - While a data replace holds layout and list writes (`replace-hold`: from
 *   its database write until `refresh-all` has opened the new data), the
 *   layout in memory is the replaced one: nothing writes it — an edit, a
 *   rename, a reorder, a delete, a switch or a new layout changes nothing
 *   and says so, an undo / redo is refused, view state isn't written.
 */
export interface WorkspaceState {
  /** Stored layouts in the picker's order (`sortOrder`, then oldest first). */
  layouts: Layout[]
  activeLayoutId: number | null
  /** The open layout as shown — with a divider drag's frames (`null` until `init`). */
  working: Layout | null
  /** The open layout as committed: every edit and view change, without a drag's frames (`null` until `init`). */
  saved: Layout | null
  /**
   * The open layout's last write failed: what is on screen isn't stored
   * yet. The next write of the layout (an edit, `retryWrite`) clears it.
   */
  writeFailed: boolean
  /** How many writes of committed edits are still running (the top bar marks the layout controls while any is: `data-layout-writing`). */
  writesPending: number
  /**
   * Layouts repaired when they were read (`ReadLayout.fixes`: a part this
   * build can't use dropped or reset) whose stored row still has those
   * parts. The layout's first edit writes the repair; until then nothing
   * writes the layout back (view state stays in memory).
   */
  repairedIds: ReadonlySet<number>
  hydrated: boolean
  /**
   * Transient: a structural resize drag's preview (`ResizePreview`), set by
   * the handle per frame and cleared at its end — never saved, never kept
   * in the browser, never unsaved, never an undo step.
   */
  resizePreview: ResizePreview | null

  /**
   * Opens the active layout (creating an empty "Default" one when none
   * exists). Safe to call more than once or concurrently. Call after app
   * startup has loaded the sync file.
   */
  init: () => Promise<void>
  /**
   * Opens a layout. Unknown id → no-op. Never rejects: a failure is
   * reported, the open layout kept — as it is when the open layout's
   * failed write fails again (`writeFailed`).
   */
  load: (id: number) => Promise<void>
  /**
   * Stores a new, empty layout named `name` (after the others) and opens
   * it. Resolves its id, or `null` for an empty name or a failed write (the
   * snackbar says so).
   */
  createLayout: (name: string) => Promise<number | null>
  /**
   * Writes the open layout again after a failed write (`writeFailed`).
   * Resolves whether it is stored now (nothing to write: `true`); never
   * rejects.
   */
  retryWrite: () => Promise<boolean>
  /**
   * Duplicate layout…: stores a copy of the open layout as a new layout
   * named `name` (after the others) and opens it. The lists it shows are
   * copied for the new layout (with their manual order) and its
   * tabs show the copies; the layout it came from keeps its own. Returns
   * the new id, or `null` for an empty name or a failed write.
   */
  duplicateLayout: (name: string) => Promise<number | null>
  /**
   * Renames a layout (not a structural edit: no undo step). Empty name → `false`.
   * With `hue`, sets its hue in the same write (`null` = none; D19 — the
   * Edit layout dialog's swatches). With `icon`, sets its icon in the same
   * write (items 11, 14; `{ kind: 'none' }` = No icon) — absent leaves it.
   */
  rename: (id: number, name: string, hue?: string | null, icon?: IconValue) => Promise<boolean>
  /**
   * Deletes a layout — never the last one (`false`). Deleting the open layout
   * opens the most recently used remaining one. The lists it owns go with
   * it (their manual order too). Not undoable. Never
   * rejects: a failed delete is reported and resolves false; a failure after
   * the delete committed (opening the next layout) is reported too.
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

  /**
   * Adds a new widget tab at `target`. Returns its id, or `null` when the
   * target is unknown or the tab would show a list another layout owns. This and every structural edit below is saved at once
   * as one undo step (see the store's comment).
   */
  addWidget: (kind: WidgetKind, target: LayoutDropTarget, seed?: TabSeed) => string | null
  moveTab: (tabId: string, target: LayoutDropTarget) => void
  /** Moves a whole cell (by id) with all its tabs. */
  movePanel: (cellId: string, target: LayoutDropTarget) => void
  closeTab: (tabId: string) => void
  /** Closes a cell (by id) with all its tabs: a neighbour takes its space, or it stays empty (`closeCell`). */
  closeCell: (cellId: string) => void
  /** Splits a cell: a new empty cell on `side` of it. Returns the new cell's id. */
  splitCell: (cellId: string, side: Side) => string | null
  /** Inserts a row / column at the layout's `edge` with one new empty cell across it. Returns that cell's id. */
  insertTrack: (edge: Side) => string | null
  /** Merges cell `bId` into cell `aId` when they make a rectangle (the tabs join); `false` when they don't. */
  mergeCells: (aId: string, bId: string) => boolean
  /**
   * View state: batched track resize (by track id, either axis: a weighted
   * track's weight, a fixed one's px), saved at once. `live`: one frame of
   * a divider drag — only the working copy changes until `endResize` (the
   * drag's end) saves the result once.
   */
  setTrackSizes: (sizeById: Readonly<Record<string, number>>, opts?: ResizeOptions) => Promise<void>
  /**
   * Drags a stretch of grid line by `delta` px (`moveEdge`): when it only
   * resizes the two tracks beside a whole line, a resize (view state, as
   * `setTrackSizes`); when it moves part of a line (a new line and track),
   * a structural edit (`Moved divider`, an undo step with no snackbar: the
   * table shows it; `undo.mergeKey` merges a divider's key steps into one).
   */
  moveEdge: (stretch: EdgeStretch, delta: number, opts: MoveEdgeOptions, undo?: EditUndoOptions) => Promise<void>
  /**
   * View state: the sizes of `axes` copied from `from` (`copySizes`) — a
   * frame of a drag computed on the layout as it started (its whole lines
   * moved, a fit row given a height — its `fitPx`), or the start's sizes put back. `live` as
   * for `setTrackSizes`.
   */
  copyTrackSizes: (from: LayoutBody, axes: readonly GridAxis[], opts?: ResizeOptions) => Promise<void>
  /**
   * View state: a row track's `fitPx` cleared (`withoutTrackFitPx`) — a
   * Numbers-only row fits its content again. Saved at once, onto the saved
   * layout too where the row is the same track there.
   */
  clearTrackFitPx: (trackId: string) => Promise<void>
  /** The end of a live resize: saves what its frames changed, once. */
  endResize: () => Promise<void>
  /** Sets (or clears, `null`) the structural resize preview; a preview drawing the same table as the current one changes nothing. */
  setResizePreview: (preview: ResizePreview | null) => void
  /**
   * Layout config of a tab (e.g. a lens tab's list, a calendar's date types,
   * an editor's Save): one undo step, `description` its name (default
   * `Changed “<tab>”`). A list tab's list must be this layout's own
   * lists: a patch naming another's changes nothing.
   */
  patchTabConfig: <K extends WidgetKind>(tabId: string, kind: K, patch: Partial<TabConfigOf<K>>, description?: string) => void
  /** "Change widget": swaps the tab's kind in place, with the new kind's defaults. */
  changeTabKind: (tabId: string, kind: WidgetKind, seed?: TabSeed) => void
  /**
   * Name and icon… (items 11, 14): renames tab `tabId` — a list tab's list
   * (as Edit list does; a blank name keeps it), a Number's or a chart's
   * `config.name`, any other kind's tab name (blank: back to the kind's
   * label) —, one undo step (`Renamed tab to “Inbox”`). A name longer than
   * the kind's stored name may be is cut to it (`tabNameMax`). Resolves
   * whether it wrote.
   */
  renameTab: (tabId: string, name: string) => Promise<boolean>
  /** Sets tab `tabId`'s picked icon (`null`: never picked, the kind's icon), one undo step (`Changed icon of “Inbox”`). */
  setTabIcon: (tabId: string, icon: IconValue | null) => boolean

  /** View state: switch a cell's tab. */
  setActiveTab: (tabId: string) => Promise<void>
  /** View state: collapse / expand row tracks (by id; one, or several in one write — a cell's). */
  setTrackCollapsed: (trackIds: string | readonly string[], collapsed: boolean) => Promise<void>
  /** View state of a tab (e.g. a calendar's view / offset). */
  patchTabViewState: <K extends WidgetKind>(tabId: string, kind: K, patch: Partial<TabViewStateOf<K>>) => Promise<void>
}

function randomId(): string {
  return `w-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * A new tab's seed: a Neglect map with no tags given colours by the
 * `Project: …` tags; a Project pulse with none reads them; a Breakdown
 * (every preset) writes its Due and Follow-up count columns in Settings ›
 * Tasks' ranges of the moment (`defaultBreakdownColumns`).
 */
function seedFor(kind: WidgetKind, seed: TabSeed | undefined): TabSeed | undefined {
  if (kind === 'neglect' && !seed?.neglectTagIds) return { ...seed, neglectTagIds: projectTagIds(useTagStore.getState().tags) }
  if (kind === 'pulse' && !seed?.tagIds) return { ...seed, tagIds: projectTagIds(useTagStore.getState().tags) }
  if (kind === 'breakdown' && !seed?.breakdown?.columns) {
    return { ...seed, breakdown: { ...seed?.breakdown, columns: defaultBreakdownColumns(useSettingsStore.getState().tabBadges) } }
  }
  return seed
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

/**
 * The longest name Name and icon… keeps for a tab of `kind`: what the
 * stored shape of the name it writes allows — a Number's `config.name`
 * (`NUMBER_NAME_MAX`), a chart's and Created vs completed's
 * (`CHART_NAME_MAX`), any other kind's tab name (`TAB_NAME_MAX`; a list
 * tab's name is its list's, which has no limit of its own). A longer name
 * would store a layout row the import check refuses.
 */
export function tabNameMax(kind: WidgetKind): number {
  if (kind === 'number') return NUMBER_NAME_MAX
  if (kind === 'breakdown' || kind === 'pivot' || kind === 'trend') return CHART_NAME_MAX
  return TAB_NAME_MAX
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
  useUndoStore.getState().notify(`Repaired layout "${layout.name}" — ${fixes.join(', ')}. Your next change to it keeps the repair.`)
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
 * Whether a kept new layout can become a stored one: it shows no list (no
 * list tab) — every list belongs to a stored layout, so
 * a layout not stored yet can't show one.
 */
function showsNoList(body: LayoutBody): boolean {
  return layoutListRefs(body).size === 0
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
 * The lists `next` names that `before` didn't and that belong elsewhere —
 * another layout, or no layout. A layout shows only its own
 * lists, so an edit that would show one of these is refused. A list that
 * doesn't exist (any more) isn't anyone's: a tab on it shows it as deleted.
 */
function foreignListRefs(before: LayoutBody, next: LayoutBody, layoutId: number): number[] {
  const had = layoutListRefs(before)
  const added = [...layoutListRefs(next)].filter((id) => !had.has(id))
  if (added.length === 0) return []
  const defs = useListDefinitionStore.getState().listDefinitions
  return added.filter((id) => {
    const def = defs.find((d) => d.id === id)
    return def != null && ownerLayoutId(def) !== layoutId
  })
}

/**
 * Takes a removal of a layout's lists into the stores: the deleted ones
 * forgotten (an Edit list open on one closes, dropping its draft), the ones
 * handed to another layout read again (their owner changed).
 */
async function applyRemoved({ deleted, handedOver }: OwnedListsRemoved): Promise<void> {
  useListDefinitionStore.getState().forgetLists(deleted)
  if (handedOver.length > 0) await useListDefinitionStore.getState().load()
}

/**
 * Deletes the lists layout `layoutId` owns that none of `bodies` shows,
 * nor its stored row (`layoutRepository.pruneOwnedLists`) — at launch, the
 * lists edits a reload dropped had made. A failed delete only leaves them
 * in place (hidden, unshown) until the layout's next edit.
 */
async function pruneOwnedLists(layoutId: number, ...bodies: LayoutBody[]): Promise<void> {
  const shown = new Set(bodies.flatMap((b) => [...layoutListRefs(b)]))
  try {
    await applyRemoved(await trackWrite(() => layoutRepository.pruneOwnedLists(layoutId, shown)))
  } catch (err) {
    console.warn('[workspace] removing the layout\'s unshown lists failed', err)
  }
}

/**
 * Brings back lists a committed edit removed (with their manual order) and
 * reads the list stores again. Rejects when the write fails (the undo store
 * keeps the step); `UndoGone` when their layout is gone.
 */
async function restoreLists(removed: OwnedListsRemoved | null): Promise<void> {
  if (!removed || removed.rows.defs.length === 0) return
  const back = await trackWrite(() => layoutRepository.restoreLists(removed.rows))
  if (!back) throw new UndoGone('The lists can’t come back: their layout is gone.')
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
}

/** The lists of layout `layoutId` that `body` shows, as copies for a new layout (each as saved). */
function ownedListCopies(layoutId: number, body: LayoutBody): ListCopy[] {
  const shown = layoutListRefs(body)
  const copies: ListCopy[] = []
  for (const saved of useListDefinitionStore.getState().listDefinitions) {
    if (!shown.has(saved.id) || ownerLayoutId(saved) !== layoutId) continue
    const { id: _id, sortOrder: _order, owner: _owner, ...def } = saved
    void _id
    void _order
    void _owner
    copies.push({ from: saved.id, def })
  }
  return copies
}

/** The ids of the read layouts that were repaired. */
function repairedOf(reads: readonly ReadLayout[]): Set<number> {
  return new Set(reads.filter((r) => r.fixes.length > 0).map((r) => r.layout.id))
}

/** A tab's name in an undo step: a list tab's list (as saved), else its kind's or its own (`kindTabTitle`). */
function tabName(layout: LayoutBody, tabId: string): string {
  const tab = getTab(layout, tabId)
  if (!tab) return 'widget'
  if (tab.kind === 'lens' && tab.config.listDefinitionId != null) {
    const id = tab.config.listDefinitionId
    return useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)?.name ?? 'List'
  }
  return kindTabTitle(tab)
}

/** `Closed cell`, `Closed cell “Notes”`, `Closed cell (3 tabs)`. */
function closeCellDescription(layout: LayoutBody, cellId: string): string {
  const cell = layout.cells.find((c) => c.id === cellId)
  const [first] = cell?.tabs ?? []
  if (!cell || !first) return 'Closed cell'
  return cell.tabs.length === 1 ? `Closed cell “${tabName(layout, first.id)}”` : `Closed cell (${cell.tabs.length} tabs)`
}

/** What one write of a layout did: whether it landed, and the lists it removed (`putAndPrune`). */
interface WriteResult {
  ok: boolean
  removed: OwnedListsRemoved | null
}

/**
 * One undo step of structural edits to layout `layoutId` — one edit, or a
 * run merged by its key: the layout before the first and after the last,
 * what each commit removed (brought back by Undo, newest first), and what
 * Undo's own commit removed (brought back by Redo).
 */
interface EditRun {
  layoutId: number
  before: LayoutBody
  after: LayoutBody
  removed: Array<Promise<WriteResult>>
  undone: Promise<WriteResult> | null
}

/** Each structural step's run, by its undo entry (a merge carries it to the merged entry). */
const runs = new WeakMap<UndoEntry, EditRun>()

/** Whether `entry` is the undo step of a structural layout edit (for tests and diagnostics). */
export function isLayoutEditStep(entry: UndoEntry): boolean {
  return runs.has(entry)
}

/** The axes the live frames of a resize under way changed in layout `layoutId`'s working copy, saved at its end. */
let pendingSizes: { layoutId: number; groups: GridAxis[] } | null = null
registerModuleReset(() => { pendingSizes = null })

/** Bumped by the test reset: a write left in flight settles without touching the new state. */
let generation = 0
registerModuleReset(() => { generation++ })

/** The layout writes of committed edits still running (with what follows each: the lists taken into the stores). */
const layoutWrites = new Set<Promise<unknown>>()

/**
 * Resolves once every layout write of a committed edit has run, with what
 * follows it (`writeLayout`) — for tests, and awaited after each one
 * (`settleModuleWork`).
 */
export async function settleLayoutWrites(): Promise<void> {
  while (layoutWrites.size > 0) await Promise.allSettled([...layoutWrites])
}
registerModuleSettle(settleLayoutWrites)
// A data replace writes once they have landed (`replace-hold`).
registerReplaceSettle(settleLayoutWrites)

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /**
   * Writes layout `layout` (`putAndPrune`) and takes the lists it removed
   * into the stores. A failed write is reported and marks the open layout
   * `writeFailed` (only while it is still the layout written); a write that
   * lands clears it and the layout's repair mark. Never rejects.
   */
  async function writeLayout(layout: Layout): Promise<WriteResult> {
    const gen = generation
    try {
      const removed = await trackWrite(() => layoutRepository.putAndPrune(layout))
      if (gen !== generation) return { ok: true, removed }
      const repairedIds = get().repairedIds.has(layout.id) ? new Set([...get().repairedIds].filter((id) => id !== layout.id)) : get().repairedIds
      set({ repairedIds, ...(get().saved?.id === layout.id ? { writeFailed: false } : {}) })
      await applyRemoved(removed)
      return { ok: true, removed }
    } catch (err) {
      if (gen === generation && get().saved?.id === layout.id) {
        set({ writeFailed: true })
        reportWriteFailure(`Couldn't save layout "${layout.name}".`, err)
      } else {
        console.warn(`[workspace] couldn't save layout "${layout.name}"`, err)
      }
      return { ok: false, removed: null }
    }
  }

  /** Makes `next` the open layout (shown and committed) and writes it. */
  function commit(next: Layout): Promise<WriteResult> {
    set({ working: next, saved: next, layouts: replaceLayout(get().layouts, next) })
    const gen = generation
    set({ writesPending: get().writesPending + 1 })
    const written = writeLayout(next)
    layoutWrites.add(written)
    void written.finally(() => {
      layoutWrites.delete(written)
      if (gen === generation) set({ writesPending: Math.max(0, get().writesPending - 1) })
    })
    return written
  }

  /**
   * The open layout as an undo / redo of `run` may change it: it must be
   * open (`UndoRefused`, the step stays) and still exist (`UndoGone`).
   */
  function openFor(run: EditRun, verb: 'undo' | 'redo', description: string): Layout {
    assertNoReplaceHold()
    const { layouts, saved } = get()
    const layout = layouts.find((l) => l.id === run.layoutId)
    if (!layout) throw new UndoGone(`Can’t ${verb}: ${description} — its layout is gone.`)
    if (saved?.id !== run.layoutId) throw new UndoRefused(`Open layout “${layout.name}” to ${verb}: ${description}.`)
    return saved
  }

  /**
   * Records a committed edit of layout `layoutId` (from `before` to
   * `after`, its write `written`) as an undo step with the snackbar — or,
   * under the newest step's merge key, as more of that step.
   */
  function recordEdit(layoutId: number, before: LayoutBody, after: LayoutBody, written: Promise<WriteResult>, description: string, { mergeKey, quiet = false }: EditUndoOptions): void {
    const undo = useUndoStore.getState()
    if (undo.isPerformingUndoRedo) return
    const into = mergeKey === undefined ? null : undo.mergeTarget(mergeKey)
    const prior = into ? runs.get(into) : undefined
    // More of the newest step's run (the same key, the same layout): the run
    // takes this edit's table and removals; the merged step's undo (the
    // first's) and redo (this one's) both read the run.
    const merges = prior != null && prior.layoutId === layoutId
    const run: EditRun = merges ? prior : { layoutId, before, after, removed: [], undone: null }
    run.after = after
    run.removed.push(written)
    const entry: UndoEntry = {
      description,
      // A key the newest step has for another layout: a step of its own, not merged into that one.
      ...(mergeKey !== undefined && (!into || merges) ? { mergeKey } : {}),
      undo: () => undoRun(run, description),
      redo: () => redoRun(run, description),
    }
    const top = undo.push(entry, !quiet)
    runs.set(top, run)
  }

  /**
   * Undo of a run: its removed lists back (newest commit's first), then the
   * table as before it, with the view state of now. A failed write shows
   * (`writeFailed`): the step is undone on screen all the same.
   */
  async function undoRun(run: EditRun, description: string): Promise<void> {
    openFor(run, 'undo', description)
    const results = await Promise.all(run.removed)
    for (const r of [...results].reverse()) await restoreLists(r.removed)
    const current = openFor(run, 'undo', description)
    run.undone = commit(withViewStateOf(withLayoutBody(current, run.before), current))
    await run.undone
  }

  /** Redo of a run: the lists its undo removed back, then the table after it, with the view state of now. */
  async function redoRun(run: EditRun, description: string): Promise<void> {
    openFor(run, 'redo', description)
    await restoreLists((await run.undone)?.removed ?? null)
    const current = openFor(run, 'redo', description)
    const written = commit(withViewStateOf(withLayoutBody(current, run.after), current))
    run.removed = [written]
    await written
  }

  /**
   * Applies a structural edit to the open layout and commits it (`commit`)
   * as one undo step (`describe`: its name, from the layout before). Returns
   * whether it changed. An edit that would show a list the layout doesn't
   * own (a tab's list — `foreignListRefs`) is refused: nothing changes. One
   * that changes only view state is written as view state, with no step.
   */
  function edit(fn: (layout: Layout, genId: IdGen) => Layout, describe: string | ((before: Layout, next: Layout) => string), opts: EditUndoOptions = {}): boolean {
    const { working, saved } = get()
    if (!working || !saved) return false
    if (refusedByReplaceHold()) return false
    let next = fn(working, idGenFor(working))
    if (next === working) return false
    const foreign = foreignListRefs(working, next, working.id)
    if (foreign.length > 0) {
      console.warn('[workspace] refused an edit showing lists of another layout:', foreign)
      return false
    }
    next = withTrackIdsOf(next, working)
    if (layoutStructureEqual(next, working)) {
      const viewed = next
      void editView(() => viewed)
      return true
    }
    const description = typeof describe === 'function' ? describe(working, next) : describe
    const committed: Layout = { ...next, modifiedAt: new Date() }
    const written = commit(committed)
    recordEdit(saved.id, layoutBodyOf(saved), layoutBodyOf(committed), written, description, opts)
    return true
  }

  /**
   * A resize (`fn`, changing the sizes of `groupsOf(working)`) of the
   * working copy — never an undo step: sizes aren't structure. A `live` one
   * (a frame of a divider drag) changes only the working copy, with no
   * write per frame: the drag's end (`commitSizes`) saves the result once.
   */
  function resize(fn: (layout: Layout) => Layout, groupsOf: (layout: Layout) => GridAxis[], { live = false }: ResizeOptions = {}): Promise<void> {
    const { working } = get()
    if (!working) return Promise.resolve()
    const next = fn(working)
    if (next !== working) {
      set({ working: next })
      if (pendingSizes?.layoutId !== working.id) pendingSizes = { layoutId: working.id, groups: [] }
      // Once per axis, not per frame of a drag.
      for (const g of groupsOf(working)) if (!pendingSizes.groups.includes(g)) pendingSizes.groups.push(g)
    }
    return live ? Promise.resolve() : commitSizes()
  }

  /** Saves the sizes the resizes since the last call changed, as view state (`editView`). */
  function commitSizes(): Promise<void> {
    const pending = pendingSizes
    pendingSizes = null
    const { working } = get()
    if (!pending || working?.id !== pending.layoutId) return Promise.resolve()
    return editView((layout) => copySizes(layout, working, pending.groups))
  }

  /**
   * Applies a view-state change to the open layout and writes it onto the
   * stored row — unless that layout was repaired when read and has had no
   * edit since: writing it would also write the repair, which only an edit
   * (or the audit's cleanup) does. Its view state then lasts until a reload,
   * or goes with its first edit. A failed write keeps it for this session.
   */
  async function editView(fn: (layout: Layout) => Layout): Promise<void> {
    const { working, saved, layouts, repairedIds } = get()
    // The layout in memory is the replaced one (the reload opens the new data next).
    if (!working || replaceHoldActive()) return
    const nextWorking = fn(working)
    const nextSaved = saved ? fn(saved) : saved
    if (nextWorking === working && nextSaved === saved) return
    set({
      working: nextWorking,
      saved: nextSaved,
      ...(nextSaved && nextSaved !== saved ? { layouts: replaceLayout(layouts, nextSaved) } : {}),
    })
    if (nextSaved && nextSaved !== saved && !repairedIds.has(nextSaved.id)) {
      // On the layout as stored: an edit's write made just before keeps its
      // structure (the writes run in the order they were made).
      await layoutRepository.updateView(nextSaved.id, fn).catch((err: unknown) => {
        console.warn('[workspace] saving the view state failed', err)
      })
    }
  }

  /**
   * Opens a read layout. A layout repaired when read opens with the repair
   * in memory, and the snackbar says what was repaired.
   */
  function open(read: ReadLayout, layouts: Layout[], repairedIds: ReadonlySet<number>): void {
    const { layout, fixes } = read
    set({
      layouts, repairedIds, activeLayoutId: layout.id, working: layout, saved: layout,
      writeFailed: false, hydrated: true, resizePreview: null,
    })
    if (fixes.length > 0) reportRepair(layout, fixes)
  }

  /**
   * Before the open layout is left: when its last write failed, writes it
   * once more. Resolves whether leaving loses nothing (on `false` the
   * snackbar has said so and the caller stays).
   */
  async function readyToLeave(): Promise<boolean> {
    if (!get().writeFailed) return true
    if (await get().retryWrite()) return true
    const name = get().saved?.name ?? 'the layout'
    useUndoStore.getState().notify(`Couldn't save layout "${name}". Retry before leaving it, or its last changes are lost.`)
    return false
  }

  /**
   * After the page load's first open: the unsaved change a build before
   * layout autosave kept in the browser (`readLayoutDraft`), once — then the
   * key goes.
   * - Of the open layout, made against its stored table (repointed onto
   *   the copies of lists it shared when an upgrade gave it its own):
   *   applied as one undo step (`Applied unsaved changes …`) — unless it
   *   shows another layout's list (dropped, and said).
   * - A kept new layout that shows no list: stored as a layout and opened
   *   (one that shows a list can't be: dropped, and said).
   * - Anything else is dropped. The lists only dropped edits showed go (the
   *   open layout's, and the draft's layout's).
   */
  async function applyKeptDraft(draft: LayoutDraftRecord | null): Promise<void> {
    clearLayoutDraft()
    const { working, saved } = get()
    if (!working || !saved) return
    let applied = false
    if (draft?.kind === 'saved' && draft.layoutId === saved.id) {
      const changes = listIdChanges(draft.base, saved)
      const base = changes && repointLayoutLists(draft.base, changes)
      if (changes && base && layoutStructureEqual(base, saved)) {
        const body = repointLayoutLists(draft.body, changes)
        await useListDefinitionStore.getState().ensureLoaded()
        // A newer open (a layout switch, a data replace) took over meanwhile.
        if (get().saved !== saved) return
        if (showsOnlyOwnLists(body, saved.id)) {
          applied = edit((layout) => withLayoutBody(layout, body), `Applied unsaved changes to layout “${saved.name}”`)
        } else {
          useUndoStore.getState().notify(`Unsaved changes to layout “${saved.name}” were dropped: they showed another layout’s list.`)
        }
      }
    }
    if (!applied) await pruneOwnedLists(saved.id, saved)
    if (draft?.kind === 'saved' && draft.layoutId !== saved.id && get().layouts.some((l) => l.id === draft.layoutId)) {
      await pruneOwnedLists(draft.layoutId)
    }
    if (draft?.kind === 'new') {
      await useListDefinitionStore.getState().ensureLoaded()
      if (get().saved !== saved) return
      if (!showsNoList(draft.body)) {
        useUndoStore.getState().notify(`The unsaved new layout “${draft.name}” was dropped: a layout shows only its own lists, and it wasn’t stored yet.`)
      } else {
        await storeKeptNewLayout(draft.name, draft.body)
      }
    }
  }

  /** A kept new layout (an older build's) stored after the others and opened. */
  async function storeKeptNewLayout(name: string, body: LayoutBody): Promise<void> {
    const now = new Date()
    const record = { name, ...body, createdAt: now, modifiedAt: now, lastUsedAt: now }
    let id: number
    try {
      id = await layoutRepository.insert(record)
    } catch (err) {
      reportWriteFailure(`Couldn't keep the unsaved new layout "${name}".`, err)
      return
    }
    await layoutRepository.setActiveId(id).catch((err: unknown) => {
      console.warn('[workspace] remembering the open layout failed', err)
    })
    const sortOrder = (await layoutRepository.get(id).catch(() => undefined))?.layout.sortOrder ?? orderAfter(get().layouts)
    const layout: Layout = { ...record, id, sortOrder }
    open({ layout, fixes: [] }, [...get().layouts.filter((l) => l.id !== id), layout], get().repairedIds)
    useUndoStore.getState().notify(`Kept the unsaved new layout “${name}”.`)
  }

  /** Opens the active layout (`init`); `kept` = the older build's kept draft, on the first open. */
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
    if (first) await applyKeptDraft(kept)
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

  /**
   * Opens layout `id` (unknown id: nothing). Never rejects: a failed read or
   * write is reported (the snackbar) and resolves false, the open layout
   * staying as it was.
   */
  async function openLayout(id: number): Promise<boolean> {
    try {
      const read = await layoutRepository.get(id)
      if (!read) return true
      const now = new Date()
      const layout: Layout = { ...read.layout, lastUsedAt: now }
      // Only the last-used time: the rest of the row stays as stored.
      await layoutRepository.touch(id, now)
      await layoutRepository.setActiveId(id)
      const repairedIds = new Set(get().repairedIds)
      if (read.fixes.length > 0) repairedIds.add(id)
      else repairedIds.delete(id)
      open({ layout, fixes: read.fixes }, replaceLayout(get().layouts, layout), repairedIds)
      return true
    } catch (err) {
      const name = get().layouts.find((l) => l.id === id)?.name ?? 'the layout'
      reportWriteFailure(`Couldn't open layout "${name}".`, err)
      return false
    }
  }

  return {
    layouts: [],
    activeLayoutId: null,
    working: null,
    saved: null,
    writeFailed: false,
    writesPending: 0,
    repairedIds: new Set(),
    hydrated: false,
    resizePreview: null,

    init() {
      if (get().hydrated) return openActive(null)
      // The page load's first open applies a kept draft. Concurrent first
      // calls (StrictMode's double effects) share it, so the draft is read
      // once.
      firstInit ??= openActive(readLayoutDraft()).finally(() => { firstInit = null })
      return firstInit
    },

    async load(id) {
      if (refusedByReplaceHold()) return
      // An open editor holding changes (Edit list, a widget editor) asks first (`editor-leave`).
      if (id !== get().activeLayoutId && editorsHoldChanges() && !(await leaveOpenEditors())) return
      if (id === get().activeLayoutId || await readyToLeave()) await openLayout(id)
    },

    async createLayout(name) {
      const clean = cleanName(name)
      if (!clean || refusedByReplaceHold()) return null
      if (editorsHoldChanges() && !(await leaveOpenEditors())) return null
      if (!(await readyToLeave())) return null
      const now = new Date()
      const record = { name: clean, ...emptyLayoutBody(), createdAt: now, modifiedAt: now, lastUsedAt: now }
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

    async retryWrite() {
      const { saved, writeFailed } = get()
      if (!saved || !writeFailed) return true
      if (refusedByReplaceHold()) return false
      return (await commit(saved)).ok
    },

    async duplicateLayout(name) {
      const clean = cleanName(name)
      const source = get().saved
      if (!clean || !source || refusedByReplaceHold()) return null
      if (editorsHoldChanges() && !(await leaveOpenEditors())) return null
      if (!(await readyToLeave())) return null
      const now = new Date()
      const { id: _from, sortOrder: _order, ...body } = source
      void _from
      void _order
      // The lists it shows are copied for the new layout; the originals stay
      // with the layout they came from.
      await useListDefinitionStore.getState().ensureLoaded()
      const copies = ownedListCopies(source.id, source)
      const original = { ...body, name: clean, createdAt: now, modifiedAt: now, lastUsedAt: now }
      let id: number
      let listIds: ReadonlyMap<number, number>
      try {
        ({ id, listIds } = await layoutRepository.insertWithListCopies(original, copies))
      } catch (err) {
        reportWriteFailure(`Couldn't duplicate layout "${source.name}".`, err)
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
      const layout: Layout = { ...record, id, sortOrder }
      open({ layout, fixes: [] }, [...get().layouts.filter((l) => l.id !== id), layout], get().repairedIds)
      return id
    },

    async rename(id, name, hue, icon) {
      const clean = cleanName(name)
      if (!clean || refusedByReplaceHold()) return false
      const renamed = <L extends WorkspaceLayout>(layout: L): L => {
        const next = { ...layout, name: clean, ...(icon ? { icon } : {}) }
        return hue === undefined ? next : setLayoutHue(next, hue)
      }
      const read = await layoutRepository.get(id)
      if (!read) return false
      // Only the name (and the hue, the icon): a layout repaired when read
      // keeps its stored row. Renamed on screen once the write has landed.
      try {
        await layoutRepository.rename(id, clean, hue, icon)
      } catch (err) {
        reportWriteFailure(`Couldn't rename layout "${read.layout.name}".`, err)
        return false
      }
      const { working, saved, layouts } = get()
      const nextSaved: Layout = renamed(saved?.id === id ? saved : read.layout)
      set({
        layouts: replaceLayout(layouts, nextSaved),
        ...(saved?.id === id ? { saved: nextSaved } : {}),
        ...(working?.id === id ? { working: renamed(get().working ?? working) } : {}),
      })
      return true
    },

    async delete(id) {
      if (refusedByReplaceHold()) return false
      if (id === get().activeLayoutId && editorsHoldChanges() && !(await leaveOpenEditors())) return false
      const name = get().layouts.find((l) => l.id === id)?.name ?? 'the layout'
      // Its lists go with it.
      let removed: OwnedListsRemoved | null
      try {
        removed = await layoutRepository.deleteUnlessLast(id)
      } catch (err) {
        reportWriteFailure(`Couldn't delete layout "${name}".`, err)
        return false
      }
      if (!removed) return false
      // Deleted from here on: what follows brings the screen in step with it.
      const repairedIds = new Set([...get().repairedIds].filter((r) => r !== id))
      try {
        const layouts = (await layoutRepository.getAll()).map((r) => r.layout)
        if (get().activeLayoutId !== id) {
          set({ layouts, repairedIds })
        } else {
          set({ repairedIds })
          const next = mostRecentlyUsed(layouts)
          if (next && !await openLayout(next.id)) throw new Error('the next layout did not open')
          set({ layouts: get().layouts.filter((l) => l.id !== id) })
        }
        await applyRemoved(removed)
      } catch (err) {
        set({ layouts: get().layouts.filter((l) => l.id !== id), repairedIds })
        reportWriteFailure(`Deleted layout "${name}", but couldn't open another. Reload the page.`, err)
      }
      return true
    },

    async reorderLayouts(orderedIds, description = 'Reordered layouts') {
      if (refusedByReplaceHold()) return false
      const before = get().layouts.map((l) => l.id)
      if (!(await applyOrder(orderedIds))) return false
      const after = get().layouts.map((l) => l.id)
      if (after.length === before.length && after.every((id, i) => id === before[i])) return true
      // Undo / redo throw on a failed write: the entry stays, to try again.
      const apply = (ids: readonly number[]) => async () => {
        assertNoReplaceHold()
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
      const changed = edit((layout, genId) => {
        const tab = createTab(kind, genId(), seedFor(kind, seed))
        tabId = tab.id
        return addTab(layout, tab, target, genId)
      }, (_before, next) => `Added “${tabId != null ? tabName(next, tabId) : widgetKindLabel(kind)}”`)
      return changed ? tabId : null
    },

    moveTab(tabId, target) {
      edit((layout, genId) => moveTab(layout, tabId, target, genId), (before) => `Moved “${tabName(before, tabId)}”`)
    },

    movePanel(panelId, target) {
      edit((layout, genId) => movePanel(layout, panelId, target, genId), 'Moved cell')
    },

    closeTab(tabId) {
      edit((layout) => closeTab(layout, tabId), (before) => `Closed tab “${tabName(before, tabId)}”`)
    },

    closeCell(cellId) {
      edit((layout) => closeCell(layout, cellId), (before) => closeCellDescription(before, cellId))
    },

    splitCell(cellId, side) {
      let newCellId: string | null = null
      edit((layout, genId) => {
        const result = splitCell(layout, cellId, side, genId)
        newCellId = result.cellId
        return result.layout
      }, 'Split cell')
      return newCellId
    },

    insertTrack(edge) {
      let newCellId: string | null = null
      edit((layout, genId) => {
        const result = insertTrack(layout, edge, genId)
        newCellId = result.cellId
        return result.layout
      }, edge === 'top' || edge === 'bottom' ? 'Inserted row' : 'Inserted column')
      return newCellId
    },

    mergeCells(aId, bId) {
      return edit((layout) => mergeCells(layout, aId, bId), 'Merged cells')
    },

    setTrackSizes(sizeById, opts) {
      return resize((layout) => setTrackSizes(layout, sizeById), (layout) => trackAxes(layout, Object.keys(sizeById)), opts)
    },

    moveEdge(stretch, delta, opts, undo) {
      const { working } = get()
      if (!working) return Promise.resolve()
      const next = moveEdge(working, stretch, delta, opts, idGenFor(working))
      if (next === working) return Promise.resolve()
      if (layoutStructureEqual(next, working)) return resize(() => next, () => [stretch.axis])
      edit(() => next, 'Moved divider', { ...undo, quiet: true })
      return Promise.resolve()
    },

    endResize() {
      return commitSizes()
    },

    setResizePreview(preview) {
      const current = get().resizePreview
      if (preview === current) return
      if (preview && current && preview.layoutId === current.layoutId && sameHandle(preview.handle, current.handle) && samePreviewBody(preview.body, current.body)) return
      set({ resizePreview: preview })
    },

    copyTrackSizes(from, axes, opts) {
      return resize((layout) => copySizes(layout, from, axes), () => [...axes], opts)
    },

    clearTrackFitPx(trackId) {
      return resize((layout) => withoutTrackFitPx(layout, trackId), () => ['rows'])
    },

    patchTabConfig(tabId, kind, patch, description) {
      edit((layout) => patchTabConfig(layout, tabId, kind, patch), (before) => description ?? `Changed “${tabName(before, tabId)}”`)
    },

    renameTab(tabId, name) {
      const working = get().working
      const tab = working ? getTab(working, tabId) : undefined
      if (!tab) return Promise.resolve(false)
      if (tab.kind === 'lens') {
        // A list tab's name is its list's (the same write as Edit list's; a blank one keeps it).
        const listId = tab.config.listDefinitionId
        const listName = name.trim()
        if (listId == null || !listName) return Promise.resolve(false)
        return useListDefinitionStore.getState().editList(listId, (d) => ({ ...d, name: listName }), `Renamed tab to “${listName}”`)
      }
      // Never longer than the kind's stored name may be (`tabNameMax`).
      const trimmed = name.trim().slice(0, tabNameMax(tab.kind)).trimEnd()
      const shown = trimmed || (tab.kind === 'trend' ? trendName({}) : widgetKindLabel(tab.kind))
      const description = `Renamed tab to “${shown}”`
      if (tab.kind === 'number' || tab.kind === 'breakdown' || tab.kind === 'pivot') {
        return Promise.resolve(edit((layout) => patchTabConfig(layout, tabId, tab.kind, { name: trimmed }), description))
      }
      if (tab.kind === 'trend') {
        return Promise.resolve(edit((layout) => patchTabConfig(layout, tabId, 'trend', { name: trimmed || undefined }), description))
      }
      return Promise.resolve(edit((layout) => setTabLabel(layout, tabId, { name: trimmed || null }), description))
    },

    setTabIcon(tabId, icon) {
      return edit((layout) => setTabLabel(layout, tabId, { icon }), (before) => `Changed icon of “${tabName(before, tabId)}”`)
    },

    changeTabKind(tabId, kind, seed) {
      edit(
        (layout) => replaceTab(layout, tabId, withLabelOf(createTab(kind, tabId, seedFor(kind, seed)), getTab(layout, tabId))),
        (before) => `Changed “${tabName(before, tabId)}” to ${widgetKindLabel(kind)}`,
      )
    },

    setActiveTab(tabId) {
      return editView((layout) => setActiveTab(layout, tabId))
    },

    setTrackCollapsed(trackIds, collapsed) {
      const ids = typeof trackIds === 'string' ? [trackIds] : trackIds
      return editView((layout) => ids.reduce((next, id) => setTrackCollapsed(next, id, collapsed), layout))
    },

    patchTabViewState(tabId, kind, patch) {
      return editView((layout) => patchTabViewState(layout, tabId, kind, patch))
    },

  }
})
