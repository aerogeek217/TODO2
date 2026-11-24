import { create } from 'zustand'
import { byLayoutOrder, layoutRepository, type OwnedListsRemoved, type ReadLayout, type TransferWritten } from '../data/layout-repository'
import { trackWrite } from './store-helpers'
import { applyRemoved, foreignListRefs, listCopiesOf, ownedListCopies, pruneListsAmong, pruneOwnedLists, restoreLists } from './layout-lists'
import { closeCellDescription, tabName } from './layout-step-names'
import { UndoGone, UndoRefused, useUndoStore, type UndoEntry } from './undo-store'
import { undoable } from './undoable'
import {
  closeOpenEditors,
  editorsHoldChanges,
  layoutLeaveAsks,
  leaveLayout,
  leaveOpenEditors,
  quitLayoutEditors,
  registerOpenEditor,
} from './editor-leave'
import { useUIStore } from './ui-store'
import { assertNoReplaceHold, refusedByReplaceHold, registerReplaceSettle, replaceHoldActive } from './replace-hold'
import { useListDefinitionStore } from './list-definition-store'
import { useListOrderStore } from './list-order-store'
import { useTagStore } from './tag-store'
import { useSettingsStore } from './settings-store'
import { defaultBreakdownColumns } from '../models/chart-widgets'
import { trendName } from '../models/glance-widgets'
import type { IconValue } from '../models/icon'
import { projectTagIds } from '../utils/neglect-map'
import { registerModuleReset, registerModuleSettle } from '../utils/module-reset'
import {
  LAYOUT_NAME_MAX,
  createTab,
  widgetKindLabel,
  emptyLayoutBody,
  layoutBodyOf,
  tabNameMax,
  withLayoutBody,
  type CellArea,
  type GridAxis,
  type LayoutBody,
  type PersistedWorkspaceLayout,
  type TabConfigOf,
  type TabSeed,
  type TabViewStateOf,
  type WidgetKind,
  type WorkspaceLayout,
} from '../models/workspace-layout'
import { findTab, getTab, layoutBodyEqual, layoutIds, layoutStructureEqual } from '../utils/workspace-layout-queries'
import { layoutListRefs, repointLayoutLists } from '../utils/workspace-layout-lists'
import { copySizes, setTrackSizes, trackAxes, withoutTrackFitPx } from '../utils/workspace-layout-sizes'
import { withViewStateOf } from '../utils/workspace-layout-view'
import {
  addTab,
  closeCell,
  closeTab,
  evenTracks,
  insertTrack,
  insertTrackAt,
  insertTrackBeside,
  mergeCells,
  mergeTrackInto,
  moveEdge,
  movePanel,
  moveTab,
  patchTabConfig,
  patchTabViewState,
  placeIncomingTabs,
  removeTabKeepCell,
  removeTabsKeepCell,
  removeTrack,
  replaceTab,
  setActiveTab,
  setCellArea,
  setTrackCollapsed,
  setLayoutHue,
  setTabLabel,
  splitCell,
  swapCells,
  withLabelOf,
  withTrackIdsOf,
  type IdGen,
  type IncomingTarget,
  type LayoutDropTarget,
  type MoveEdgeOptions,
} from '../utils/workspace-layout-ops'
import type { EdgeStretch, Side } from '../utils/workspace-grid'
import { samePreviewBody } from '../utils/workspace-preview'
import { cardName, stretchedArea, tapOutcome, type StretchDirection, type TapOutcome, type TapTarget } from '../utils/layout-edit-cards'
import { carriedTabs, incomingListIds, incomingPlaced, transferListPlan, type IncomingTransfer, type TransferWhat } from '../utils/layout-transfer'

type Layout = PersistedWorkspaceLayout

function sameHandle(a: ResizeHandle, b: ResizeHandle): boolean {
  return a.axis === b.axis && a.beforeId === b.beforeId && a.afterId === b.afterId
}

/** A resize from a divider: `live` = one frame of a drag (see `setTrackSizes`). */
interface ResizeOptions {
  live?: boolean
}

/**
 * The resize handle a preview belongs to: a divider (its axis and the first
 * cells on either side, as it was keyed when the drag started). The
 * crossing handles went with the layout edit mode (E4): a divider's plain
 * drag moves its whole line.
 */
export type ResizeHandle = { kind: 'divider'; axis: GridAxis; beforeId: string; afterId: string }

/**
 * A resize drag whose move changes the structure (part of a line moved, or a
 * line onto or past another): the table as its release will leave it
 * (`moveEdge`'s probe, throwaway track ids), drawn instead of the working
 * copy's grid while the drag runs (`utils/workspace-preview`).
 */
interface ResizePreview {
  layoutId: number
  body: LayoutBody
  handle: ResizeHandle
}

/**
 * The layout edit mode's preview of a structural edit before it is made: an
 * edge tab, a toolbar's Split, a merge button or a Merge ▾ entry hovered —
 * the table drawn as the edit would leave it
 * (`body`, from `utils/structure-preview.structureProbe`), its new empty
 * cells and the cells that grow marked, and the edit said in words in the
 * mode bar (`hint`). Transient: never saved, never an undo step; every edit
 * clears it.
 */
export interface StructurePreview {
  layoutId: number
  body: LayoutBody
  /** The cells the edit makes (empty): drawn as the new slots. */
  newCellIds: readonly string[]
  /** The cells that grow across the new track: outlined. */
  grewCellIds: readonly string[]
  /** The words on a grown cell's outline (default `stretches`; `''` none: a merge's cell). */
  grewLabel?: string
  /** The edit in words, for the mode bar. */
  hint: string
}

/** What an undo step of a structural edit says to do with its undo / redo: a key that merges a run of steps into one. */
interface EditUndoOptions {
  /** Steps passing the same key one after another stay one undo step (a divider stepped by the arrow keys). */
  mergeKey?: string
  /** No undo snackbar: the step is on the undo stack all the same (a divider moved — the table shows it). */
  quiet?: boolean
}

/**
 * The layout edit mode's session (layout edit mode E1): which layout it
 * edits, the cell it selected, its own undo steps and the lists it made.
 */
interface LayoutEditSession {
  layoutId: number
  /** The selected cell (opened from a cell's ⋯ › Edit layout), or none. */
  selectedCellId: string | null
  /** The mode's undo steps: the draft's body before each structural edit, oldest first. */
  undo: readonly LayoutBody[]
  /** Its redo steps: the draft's body before each undo, oldest first. */
  redo: readonly LayoutBody[]
  /** The lists made while it was on (`createListAndTab`): those its end doesn't keep are deleted. */
  createdLists: readonly number[]
  /**
   * The selected card's Move (or Space on it) armed a move: the next tap
   * on a slot moves it there, on another card's middle swaps them, on its
   * tab area joins them (`layout-edit-cards.tapOutcome`). Esc, an edit, an
   * undo disarm it. A tap alone never arms one.
   */
  moveArmed?: boolean
  /**
   * Move / Copy to layout: the widgets in hand, brought from another layout
   * to be placed (`placeIncoming`); Done writes both layouts as one step.
   */
  incoming?: IncomingTransfer
  /**
   * The cards show their widgets' content, dimmed (the mode bar's Content
   * toggle); off, each card is a blueprint — its icon, name and kind.
   */
  showContent?: boolean
}

/** One layout of a move between layouts (`TransferRun`): its body before and after. */
interface TransferRunPart {
  id: number
  before: LayoutBody
  after: LayoutBody
}

/**
 * The undo step of a Move / Copy to layout: both layouts' bodies, the lists
 * it handed over and the copies it made, what its writes removed — kept
 * current across its undos and redos (an undo keeps the copies' rows for
 * the redo to put back).
 */
interface TransferRun {
  description: string
  target: TransferRunPart
  /** A move's source. */
  source?: TransferRunPart
  reown: number[]
  copyIds: number[]
  copyRows: OwnedListsRemoved['rows'] | null
  removed: OwnedListsRemoved[]
}

/** Whether the layout edit mode's draft differs from the layout as stored (view state too). */
export function layoutEditChanged(s: Pick<WorkspaceState, 'editing' | 'working' | 'saved'>): boolean {
  return s.editing != null && s.working != null && s.saved != null && !layoutBodyEqual(s.working, s.saved)
}

/**
 * The lists the layout edit mode made that nothing shows and that are
 * waiting to be deleted: in the mode, those its draft no longer shows (made,
 * then undone); after Cancel, every list it made while the Restore offer
 * holds them (`discardedLists`). No list chooser offers them (Copy from…,
 * a Number's Follow a list).
 */
export function listsHeldByEdit(s: Pick<WorkspaceState, 'editing' | 'working' | 'discardedLists'>): readonly number[] {
  const { editing, working } = s
  if (!editing || !working || editing.createdLists.length === 0) return s.discardedLists
  const shown = layoutListRefs(working)
  const undone = editing.createdLists.filter((id) => !shown.has(id))
  return undone.length === 0 ? s.discardedLists : [...s.discardedLists, ...undone]
}

/** What the mode's own undo keeps at most. */
const EDIT_UNDO_MAX = 100

/**
 * Workspace layouts: the stored layouts and the open one. **Every edit is
 * saved at once** (layout autosave): nothing is ever unsaved.
 *
 * - Structural edits (add / move / close / split / merge / insert, a tab's
 *   config or kind, part of a grid line moved) commit at once: the open
 *   layout changes, its row is written (`layoutRepository.putAndPrune`) and
 *   the edit is one undo step with the snackbar, named in words
 *   (`Removed “This week”`). The lists the layout owns that it no longer
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
 *   that fails too. The lists the failed step stopped showing are deleted by
 *   that next write, which hands them to the step (`ListClaim`): its Undo
 *   brings them back all the same.
 * - A layout repaired when it was read opens with its repair in memory; its
 *   first edit writes it (until then view state isn't written).
 * - The first `init()` of a page load deletes the lists the open layout
 *   owns but doesn't show (`pruneOwnedLists`).
 * - `load(id)` switches layouts; `createLayout(name)` stores a new, empty
 *   layout at once and opens it.
 * - **The layout edit mode** (`editing`, layout edit mode E1): while it is
 *   on, `working` is its draft and `saved` stays the layout as stored.
 *   Every structural edit changes only the draft and is a step of the
 *   mode's own undo (`undoEdit` / `redoEdit`; merge keys merge there too);
 *   resizes and view state change only the draft; nothing is written.
 *   Done (`finishEdit`) commits the draft as one write and one undo step
 *   (`Edited layout “X”`), whose Undo brings back the lists it dropped;
 *   Cancel (`cancelEdit`) puts `saved` back and offers Restore in the
 *   snackbar; a reload drops the draft (the next launch's prune deletes
 *   the lists it made). Layout undo steps, a rename, Retry and the
 *   layouts' order are refused meanwhile; leaving the layout asks
 *   Save / Discard / Keep editing when the draft holds changes
 *   (`editor-leave.leaveLayout`).
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
  /** Transient: the layout edit mode's preview of an edit not yet made (`StructurePreview`). */
  structurePreview: StructurePreview | null
  /** The layout edit mode's session (`LayoutEditSession`), or `null` while the mode is off. */
  editing: LayoutEditSession | null
  /** After Cancel: the lists the session made, held for its Restore offer and deleted once it goes (`listsHeldByEdit`). */
  discardedLists: readonly number[]

  /**
   * Opens the layout edit mode on the open layout (`cellId`: that cell
   * selected). An open editor holding changes asks first (Save / Discard /
   * Keep editing); then every editor, the widget popup, the filtered-tasks
   * panel and the snackbar close. The open layout's writes land first (a
   * failed one is retried; when it fails again the mode doesn't open).
   * Resolves whether the mode is on.
   */
  enterEdit: (opts?: { cellId?: string | null }) => Promise<boolean>
  /** Selects a cell of the draft (`null`: none; `arm`: its Move, or Space, armed a move). Only while editing. */
  selectEditCell: (cellId: string | null, opts?: { arm?: boolean }) => void
  /** Disarms the pending move (Esc, Move again), the card staying selected. */
  disarmEditMove: () => void
  /**
   * A tap on a card or a slot in the mode (E3, `layout-edit-cards.tapOutcome`):
   * selects (arming a move), disarms, moves the armed card onto a slot or
   * joins it to a card as tabs (on the draft, the moved card selected).
   * Returns what it did — `menu` (a slot with nothing armed: selected) for
   * the view to open the slot's kinds.
   */
  tapEdit: (target: TapTarget) => TapOutcome
  /**
   * Moves the whole cell `cellId` to `target` (`movePanel`: a slot takes it,
   * a card joins it as tabs, a side splits) and selects the cell that holds
   * it after. Whether it moved.
   */
  moveEditCard: (cellId: string, target: LayoutDropTarget) => boolean
  /** Stretches cell `cellId` onto `area` (`setCellArea`: over its own places and empty cells only). Whether it changed. */
  setCellArea: (cellId: string, area: CellArea) => boolean
  /** Stretches cell `cellId` one track `direction` from its bottom-right corner (`stretchedArea`). Whether it changed. */
  stretchCell: (cellId: string, direction: StretchDirection) => boolean
  /** Swaps two cells' places (`swapCells`). Whether they moved. */
  swapCells: (aId: string, bId: string) => boolean
  /** The mode's undo: the draft as before its last structural edit (the view state of now kept). Nothing while its stack is empty. */
  undoEdit: () => void
  /** The mode's redo. */
  redoEdit: () => void
  /**
   * Done: commits the draft — one write, one undo step (`Edited layout
   * “X”`) — when its structure changed, writes its view state when only that
   * did, and leaves the mode. The lists the session made that the draft
   * doesn't show are deleted first. Resolves true once the mode is off.
   */
  finishEdit: () => Promise<boolean>
  /**
   * Cancel: the layout as stored comes back and the mode closes, asking
   * nothing. With changes, the snackbar says `Layout changes discarded` and
   * offers Restore (the draft and its undo steps back, the mode open again);
   * the lists the session made are deleted once that offer is gone.
   */
  cancelEdit: () => void
  /** The leave question's Discard: as Cancel, with no Restore — the session's lists deleted at once. */
  discardEdit: () => void
  /** Leaves the mode holding no changes (Esc, a layout left): its lists deleted. */
  leaveEdit: () => void
  /**
   * Closes the mode from outside, where nothing could ask (the workspace
   * page gone, the window narrowed to a phone's): the draft dropped — said
   * so when it held changes — and the session's lists deleted.
   */
  dropEdit: () => void
  /**
   * Asks Save / Discard / Keep editing about the draft (the question already
   * up: the same answer). Resolves true once the mode is off (saved or
   * discarded), false for Keep editing.
   */
  askLeaveEdit: () => Promise<boolean>
  /**
   * A data replace: the mode closes (with a notice when the draft held
   * changes) and a pending Restore is dropped — nothing deleted: the ids may
   * name other lists in the new data.
   */
  endEditForReplace: () => void
  /** A list made while editing (`createListAndTab`): deleted with the mode's end unless the draft shows it. */
  noteEditList: (listDefinitionId: number) => void
  /**
   * Move / Copy to layout (2026-11-18): carries `what` — a widget or a whole
   * cell of the open layout — to layout `to` (or a new layout named
   * `newName`), which opens in the layout edit mode with it in hand
   * (`LayoutEditSession.incoming`) to be placed. The open layout is left as
   * any switch leaves it (an open editor with changes asks first; in the
   * mode, its draft's Save / Discard / Keep editing). Nothing is written
   * until Done (`finishEdit`: both layouts, one undo step); Cancel goes back
   * to the source. Resolves whether the target's mode opened.
   */
  transferTo: (to: number | { newName: string }, what: TransferWhat, copy: boolean) => Promise<boolean>
  /**
   * Places the widgets in hand at `target` (`placeIncomingTabs`: a slot or a
   * card, the bottom, a ruler's line) — a step of the mode's undo, the cell
   * holding them selected. Whether it placed (nothing in hand, or placed
   * already: false).
   */
  placeIncoming: (target: IncomingTarget) => boolean

  /**
   * Opens the active layout (creating an empty "Default" one when none
   * exists). Safe to call more than once or concurrently. Call after app
   * startup has loaded the sync file.
   */
  init: () => Promise<void>
  /**
   * Opens a layout. Unknown id → no-op. Never rejects: a failure is
   * reported, the open layout kept — as it is when the open layout's
   * failed write fails again (`writeFailed`). No view transition (cr34
   * answer 26): every cell is new, nothing morphs, and a transition held
   * the page — losing presses — while the new layout mounted.
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
   * Name, icon and hue dialog's swatches). With `icon`, sets its icon in the same
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
  /**
   * Remove widget (the ⋯, a tab's ×, a strip Number's ×; layout edit mode
   * E4): removes tab `tabId`, and a cell it leaves with no tabs stays as an
   * empty cell (`removeTabKeepCell`) — one undo step, `Removed “X”`. Only the
   * mode's Close cell gives a cell's space away (`closeCell`).
   */
  removeWidget: (tabId: string) => void
  /** Closes a cell (by id) with all its tabs: a neighbour takes its space, or it stays empty (`closeCell`). */
  closeCell: (cellId: string) => void
  /** Splits a cell: a new empty cell on `side` of it. Returns the new cell's id. */
  splitCell: (cellId: string, side: Side) => string | null
  /** Inserts a row / column at the layout's `edge` with one new empty cell across it. Returns that cell's id. */
  insertTrack: (edge: Side) => string | null
  /** Inserts a row / column beside a cell's own, on `side` (`insertTrackBeside`). Returns the first new cell's id. */
  insertTrackBeside: (cellId: string, side: Side) => string | null
  /** Merges cell `bId` into cell `aId` when they make a rectangle (the tabs join); `false` when they don't. */
  mergeCells: (aId: string, bId: string) => boolean
  /**
   * Inserts a full row / column on line `index` of `axis` (`insertTrackAt`,
   * a ruler's "+" or Insert …; `from`: the track beside the line it takes
   * half of; `through`: the last line of a run whose tracks between are
   * slivers, which act as one line). Returns the first new cell's id.
   */
  insertTrackAt: (axis: GridAxis, index: number, from?: number, through?: number) => string | null
  /** Removes track `index` of `axis` (`removeTrack`: its widgets move as `trackRemoval` says); `false` for the last track. */
  removeTrack: (axis: GridAxis, index: number) => boolean
  /** Merges track `index` of `axis` into its neighbour `into` (`mergeTrackInto`, a sliver's Merge into). */
  mergeTrackInto: (axis: GridAxis, index: number, into: number) => boolean
  /** Even all widths / heights (`evenTracks`): a size change — view state, as a divider's. */
  evenTracks: (axis: GridAxis) => Promise<void>
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
  /** Sets (or clears, `null`) the layout edit mode's preview of an edit; outside the mode, nothing. */
  setStructurePreview: (preview: StructurePreview | null) => void
  /** The layout edit mode's Content toggle: the cards show their widgets (dimmed), or blueprints. */
  setEditContent: (on: boolean) => void
  /**
   * Layout config of a tab (e.g. a list tab's list, a calendar's date types,
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
 * `Project: …` tags; a Breakdown
 * (every preset) writes its Due and Follow-up count columns in Settings ›
 * Tasks' ranges of the moment (`defaultBreakdownColumns`) — its Follow-up
 * column with the follow-up age for the People preset (`splitBy: 'people'`
 * in the seed) and for Change widget, which seeds nothing and splits by
 * people (board V1); every other preset, Custom among them, without.
 */
function seedFor(kind: WidgetKind, seed: TabSeed | undefined): TabSeed | undefined {
  if (kind === 'neglect' && !seed?.neglectTagIds) return { ...seed, neglectTagIds: projectTagIds(useTagStore.getState().tags) }
  if (kind === 'breakdown' && !seed?.breakdown?.columns) {
    const followupAge = !seed?.breakdown || seed.breakdown.splitBy === 'people'
    return { ...seed, breakdown: { ...seed?.breakdown, columns: defaultBreakdownColumns(useSettingsStore.getState().tabBadges, { followupAge }) } }
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

/** The ids of the read layouts that were repaired. */
function repairedOf(reads: readonly ReadLayout[]): Set<number> {
  return new Set(reads.filter((r) => r.fixes.length > 0).map((r) => r.layout.id))
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

/**
 * What a step is owed when its own write fails. The lists its edit stopped
 * showing (`lists`) are then still stored, and the next write of its layout
 * that lands — Retry, a later edit, leaving the layout — deletes them
 * (`putAndPrune`). That write hands them to the step (`take`: a result
 * holding just those lists; false when the step no longer waits for it), so
 * its Undo — or Redo — brings them back as when its own write had landed.
 */
interface ListClaim {
  lists: ReadonlySet<number>
  take: (paid: Promise<WriteResult>) => boolean
}

/** The claims of steps whose write failed, by layout (`ListClaim`): settled by that layout's next write that lands. */
const listClaims = new Map<number, ListClaim[]>()
registerModuleReset(() => { listClaims.clear() })

/** The lists `from` shows that `to` doesn't. */
function listsDropped(from: LayoutBody, to: LayoutBody): Set<number> {
  const kept = layoutListRefs(to)
  return new Set([...layoutListRefs(from)].filter((id) => !kept.has(id)))
}

/** The deleted lists of `removed` that `keep` picks, with their rows. */
function deletedWhere(removed: OwnedListsRemoved, keep: (listId: number) => boolean): Pick<OwnedListsRemoved, 'deleted' | 'rows'> {
  return {
    deleted: removed.deleted.filter(keep),
    rows: { defs: removed.rows.defs.filter((d) => keep(d.id)), ranks: removed.rows.ranks.filter((r) => keep(r.listDefinitionId)) },
  }
}

/**
 * A write of layout `layoutId` landed and removed `removed`: hands each
 * step waiting there the lists it stopped showing (`ListClaim`) and returns
 * the rest — what the write's own step removed.
 */
function settleListClaims(layoutId: number, removed: OwnedListsRemoved): OwnedListsRemoved {
  const claims = listClaims.get(layoutId)
  if (!claims) return removed
  listClaims.delete(layoutId)
  const claimed = new Set<number>()
  for (const { lists, take } of claims) {
    const owed = removed.deleted.filter((id) => lists.has(id) && !claimed.has(id))
    if (owed.length === 0) continue
    if (take(Promise.resolve({ ok: true, removed: { ...deletedWhere(removed, (id) => owed.includes(id)), handedOver: [] } }))) {
      for (const id of owed) claimed.add(id)
    }
  }
  return claimed.size === 0 ? removed : { ...removed, ...deletedWhere(removed, (id) => !claimed.has(id)) }
}

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

/**
 * After Cancel: what Restore brings back (the session — its undo steps, its
 * lists — and the draft), and the layout as it was then (Restore needs it
 * unchanged since).
 */
interface RestoreOffer {
  session: LayoutEditSession
  draft: LayoutBody
  saved: LayoutBody
}

/** The layout edit mode's state outside the store (`editing`). */
const mode = {
  /** Its registration as a layout-wide editor (`editor-leave`), while it is on. */
  unregister: null as (() => void) | null,
  /** Its leave question, while it is up. */
  question: null as Promise<boolean> | null,
  /** The merge key of its newest undo step (the arrow keys stepping a divider: one step). */
  mergeKey: null as string | null,
  /** Cancel's Restore offer, while the snackbar holds it. */
  restore: null as RestoreOffer | null,
}
registerModuleReset(() => {
  mode.unregister = null
  mode.question = null
  mode.mergeKey = null
  mode.restore = null
})

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /**
   * Writes layout `layout` (`putAndPrune`) and takes the lists it removed
   * into the stores. A failed write is reported and marks the open layout
   * `writeFailed` (only while it is still the layout written); a write that
   * lands clears it and the layout's repair mark; one of a layout that is
   * gone writes nothing and says so. Never rejects. `claim`:
   * what its step is owed when it fails (`ListClaim`); a write that lands
   * settles the layout's claims, and its own result is the lists left.
   */
  async function writeLayout(layout: Layout, claim?: ListClaim): Promise<WriteResult> {
    const gen = generation
    try {
      const removed = await trackWrite(() => layoutRepository.putAndPrune(layout))
      if (gen !== generation) return { ok: true, removed }
      if (!removed) {
        // The layout was deleted while the write waited (Delete layout just
        // before the edit, another browser tab): nothing is written — the
        // row is not made again — and there is nothing to retry.
        console.warn(`[workspace] layout "${layout.name}" is gone: its change wasn't saved`)
        if (get().saved?.id === layout.id) useUndoStore.getState().notify(`Layout "${layout.name}" was deleted: this change wasn't saved.`)
        return { ok: false, removed: null }
      }
      const own = settleListClaims(layout.id, removed)
      const repairedIds = get().repairedIds.has(layout.id) ? new Set([...get().repairedIds].filter((id) => id !== layout.id)) : get().repairedIds
      set({ repairedIds, ...(get().saved?.id === layout.id ? { writeFailed: false } : {}) })
      await applyRemoved(removed)
      return { ok: true, removed: own }
    } catch (err) {
      if (gen === generation && claim && claim.lists.size > 0) {
        listClaims.set(layout.id, [...(listClaims.get(layout.id) ?? []), claim])
      }
      if (gen === generation && get().saved?.id === layout.id) {
        set({ writeFailed: true })
        reportWriteFailure(`Couldn't save layout "${layout.name}".`, err)
      } else {
        console.warn(`[workspace] couldn't save layout "${layout.name}"`, err)
      }
      return { ok: false, removed: null }
    }
  }

  /** While the layout edit mode is on, a layout's name, hue, icon and order stay as they are: says so and returns true. */
  function refusedWhileEditing(): boolean {
    if (!get().editing) return false
    useUndoStore.getState().notify('Finish editing the layout first.')
    return true
  }

  /** Makes `next` the open layout (shown and committed) and writes it (`claim`: see `writeLayout`). */
  function commit(next: Layout, claim?: ListClaim): Promise<WriteResult> {
    set({ working: next, saved: next, layouts: replaceLayout(get().layouts, next) })
    const gen = generation
    set({ writesPending: get().writesPending + 1 })
    const written = writeLayout(next, claim)
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
    // The draft isn't the layout as stored: a layout step would write over it.
    if (get().editing) throw new UndoRefused(`Finish editing the layout to ${verb}: ${description}.`)
    const { layouts, saved } = get()
    const layout = layouts.find((l) => l.id === run.layoutId)
    if (!layout) throw new UndoGone(`Can’t ${verb}: ${description} — its layout is gone.`)
    if (saved?.id !== run.layoutId) throw new UndoRefused(`Open layout “${layout.name}” to ${verb}: ${description}.`)
    return saved
  }

  /**
   * A commit of one of `run`'s tables, moving the open layout from `from`
   * to `to`, as one of the results its Undo reads (`run.removed`). Should
   * its write fail, the lists the move stops showing are the run's when a
   * later write deletes them (`ListClaim`) — while the failed write is still
   * one of those results.
   */
  function commitInto(run: EditRun, from: LayoutBody, to: Layout): Promise<WriteResult> {
    const written: Promise<WriteResult> = commit(to, {
      lists: listsDropped(from, to),
      take: (paid) => {
        if (!run.removed.includes(written)) return false
        run.removed.push(paid)
        return true
      },
    })
    return written
  }

  /**
   * Commits an edit of the open layout (from `before` to `committed`) and
   * records it as an undo step with the snackbar — or, under the newest
   * step's merge key, as more of that step.
   */
  function commitEdit(before: Layout, committed: Layout, description: string, { mergeKey, quiet = false }: EditUndoOptions): void {
    const undo = useUndoStore.getState()
    if (undo.isPerformingUndoRedo) {
      void commit(committed)
      return
    }
    const layoutId = before.id
    const after = layoutBodyOf(committed)
    const into = mergeKey === undefined ? null : undo.mergeTarget(mergeKey)
    const prior = into ? runs.get(into) : undefined
    // More of the newest step's run (the same key, the same layout): the run
    // takes this edit's table and removals; the merged step's undo (the
    // first's) and redo (this one's) both read the run.
    const merges = prior != null && prior.layoutId === layoutId
    const run: EditRun = merges ? prior : { layoutId, before: layoutBodyOf(before), after, removed: [], undone: null }
    run.after = after
    run.removed.push(commitInto(run, before, committed))
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
    const target = withViewStateOf(withLayoutBody(current, run.before), current)
    // Should this write fail: the lists the undo stops showing (a list tab
    // the step added) are its Redo's to bring back, once a later write
    // deletes them.
    const undone: Promise<WriteResult> = commit(target, {
      lists: listsDropped(current, target),
      take: (paid) => {
        if (run.undone !== undone) return false
        run.undone = paid
        return true
      },
    })
    run.undone = undone
    await undone
  }

  /** Redo of a run: the lists its undo removed back, then the table after it, with the view state of now. */
  async function redoRun(run: EditRun, description: string): Promise<void> {
    openFor(run, 'redo', description)
    await restoreLists((await run.undone)?.removed ?? null)
    const current = openFor(run, 'redo', description)
    run.removed = []
    const written = commitInto(run, current, withViewStateOf(withLayoutBody(current, run.after), current))
    run.removed.push(written)
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
    // The widgets in hand (Move / Copy to layout) may show the source's lists: Done gives them to this layout.
    const carried = incomingListIds(get().editing?.incoming)
    const foreign = foreignListRefs(working, next, working.id).filter((id) => !carried.has(id))
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
    const session = get().editing
    if (session) {
      // The layout edit mode: the draft changes, a step of its own undo.
      set({ working: next, editing: withEditStep(session, working, opts.mergeKey), resizePreview: null, structurePreview: null })
      return true
    }
    const description = typeof describe === 'function' ? describe(working, next) : describe
    const committed: Layout = { ...next, modifiedAt: new Date() }
    commitEdit(saved, committed, description, opts)
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
    if (get().editing) {
      // The layout edit mode: the draft only — Done writes it.
      const next = fn(working)
      if (next !== working) set({ working: next })
      return
    }
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
    // What is on screen from here on is a stored row: no step waits on a failed write any more.
    listClaims.clear()
    // Another layout (or the replaced data's): the mode, still on, closes.
    endSession()
    set({
      layouts, repairedIds, activeLayoutId: layout.id, working: layout, saved: layout,
      writeFailed: false, hydrated: true, resizePreview: null, structurePreview: null,
    })
    if (fixes.length > 0) reportRepair(layout, fixes)
  }

  /**
   * Before the open layout is left: waits for its writes still running (one
   * that failed after the layout was left would only be logged, its edit
   * lost without a word), then, when its last write failed, writes it once
   * more. Resolves whether leaving loses nothing (on `false` the snackbar
   * has said so and the caller stays).
   */
  async function readyToLeave(): Promise<boolean> {
    await settleLayoutWrites()
    if (!get().writeFailed) return true
    if (await get().retryWrite()) return true
    const name = get().saved?.name ?? 'the layout'
    useUndoStore.getState().notify(`Couldn't save layout "${name}". Retry before leaving it, or its last changes are lost.`)
    return false
  }

  /** Opens the active layout (`init`); the page load's first open prunes its unshown lists. */
  async function openActive(): Promise<void> {
    const first = !get().hydrated
    await layoutRepository.ensureDefault()
    const reads = await layoutRepository.getAll()
    const wanted = await layoutRepository.getActiveId()
    const layouts = reads.map((r) => r.layout)
    const active = layouts.find((l) => l.id === wanted) ?? mostRecentlyUsed(layouts)
    const read = reads.find((r) => r.layout === active)
    if (!read) return
    open(read, layouts, repairedOf(reads))
    const { saved } = get()
    if (first && saved) await pruneOwnedLists(saved.id, saved)
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
   * staying as it was. The read and the writes come first; the change on
   * screen is one synchronous step after them.
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

  // ── The layout edit mode ──

  /** `session` with the draft `before` an edit as its newest undo step — or, under its newest step's merge key, merged into that step. */
  function withEditStep(session: LayoutEditSession, before: Layout, mergeKey: string | undefined): LayoutEditSession {
    if (mergeKey !== undefined && mergeKey === mode.mergeKey && session.undo.length > 0) return { ...session, redo: [], moveArmed: false }
    mode.mergeKey = mergeKey ?? null
    return { ...session, undo: [...session.undo, layoutBodyOf(before)].slice(-EDIT_UNDO_MAX), redo: [], moveArmed: false }
  }

  /** The mode's selected cell let go once an edit took it away (a removed track's cell that joined another). */
  function keepEditSelection(): void {
    const { editing, working } = get()
    if (editing?.selectedCellId != null && !working?.cells.some((c) => c.id === editing.selectedCellId)) {
      set({ editing: { ...editing, selectedCellId: null } })
    }
  }

  /** Turns the mode on: `session` with `draft` as the working copy, registered as a layout-wide editor. */
  function beginSession(session: LayoutEditSession, draft: Layout): void {
    mode.unregister?.()
    mode.mergeKey = null
    set({ editing: session, working: draft, resizePreview: null, structurePreview: null })
    mode.unregister = registerOpenEditor({
      layoutWide: true,
      changed: () => layoutEditChanged(get()),
      ask: () => get().askLeaveEdit(),
      leave: () => get().leaveEdit(),
    })
  }

  /** Turns the mode off (the working copy as it is: the caller sets it). */
  function endSession(): void {
    mode.unregister?.()
    mode.unregister = null
    mode.mergeKey = null
    if (get().editing) set({ editing: null, structurePreview: null })
  }

  /** Closes what covers or edits the workspace before the mode opens: every editor, the widget popup, the filtered-tasks panel, the snackbar. */
  function clearForEdit(): void {
    closeOpenEditors()
    useUIStore.getState().closeWidgetPopup()
    useUIStore.getState().closeFilterPanel()
    useUndoStore.getState().dismissSnackbar()
  }

  /**
   * Before the mode opens: an open editor holding changes asks, then the
   * open layout's writes land (a failed one retried). Resolves whether it
   * may open.
   */
  async function readyToEdit(): Promise<boolean> {
    if (editorsHoldChanges() && !(await leaveOpenEditors())) return false
    await settleLayoutWrites()
    if (!get().writeFailed || await get().retryWrite()) return true
    const name = get().saved?.name ?? 'the layout'
    useUndoStore.getState().notify(`Couldn't save layout "${name}". Retry before editing it.`)
    return false
  }

  /** Deletes the lists Cancel's offer would have brought back (it is gone, not taken). */
  function dropRestore(offer: RestoreOffer): void {
    if (mode.restore === offer) mode.restore = null
    if (mode.restore == null && get().discardedLists.length > 0) set({ discardedLists: [] })
    const { saved } = get()
    const bodies = saved?.id === offer.session.layoutId ? [offer.saved, saved] : [offer.saved]
    void pruneListsAmong(offer.session.layoutId, offer.session.createdLists, ...bodies)
  }

  /** Restore (Cancel's snackbar): the mode open again on the draft and its undo steps — while the layout is still open and as it was. */
  async function restoreEdit(offer: RestoreOffer): Promise<void> {
    if (mode.restore !== offer) return
    mode.restore = null
    set({ discardedLists: [] })
    const unchanged = () => {
      const { saved, editing } = get()
      return editing == null && saved?.id === offer.session.layoutId && layoutStructureEqual(saved, offer.saved) && !replaceHoldActive()
    }
    if (!unchanged()) {
      useUndoStore.getState().notify('Couldn’t restore the layout changes: the layout changed since.')
      dropRestore(offer)
      return
    }
    if (!(await readyToEdit()) || !unchanged()) {
      dropRestore(offer)
      return
    }
    const saved = get().saved
    if (!saved) return
    clearForEdit()
    beginSession(offer.session, withLayoutBody(saved, offer.draft))
  }

  /** Writes the draft's view state (Done with no structural change): as `editView` writes it, onto the stored row. */
  async function writeDraftView(draft: Layout): Promise<void> {
    const { layouts, repairedIds } = get()
    set({ working: draft, saved: draft, layouts: replaceLayout(layouts, draft) })
    if (repairedIds.has(draft.id)) return
    await layoutRepository.updateView(draft.id, (row) => withViewStateOf(row, draft)).catch((err: unknown) => {
      console.warn('[workspace] saving the view state failed', err)
    })
  }

  // ── Move / Copy to layout ──

  /** The layout `id` as the store holds it (the open one as committed). */
  function storedRow(id: number): Layout | undefined {
    const { saved, layouts } = get()
    return saved?.id === id ? saved : layouts.find((l) => l.id === id)
  }

  /** Rows just written (a move's two layouts) taken into the store: the picker's, and the open layout's when it is one of them. */
  function takeStored(rows: readonly Layout[]): void {
    let layouts = get().layouts
    for (const row of rows) layouts = replaceLayout(layouts, row)
    const written = new Set(rows.map((r) => r.id))
    const repairedIds = new Set([...get().repairedIds].filter((id) => !written.has(id)))
    const open = rows.find((r) => r.id === get().saved?.id)
    set({ layouts, repairedIds, ...(open && !get().editing ? { working: open, saved: open, writeFailed: false } : {}) })
  }

  /** After a move's write, its undo or its redo: the lists its layout writes removed into the stores, the list stores read again when lists changed hands. */
  async function takeTransferLists(removed: readonly OwnedListsRemoved[], listsChanged: boolean): Promise<void> {
    for (const r of removed) await applyRemoved(r)
    if (listsChanged) await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
  }

  /**
   * Done with the widgets in hand placed: the target's draft and (a move)
   * the source without them written in one transaction, the carried lists
   * handed over or copied (`transferListPlan`), as one undo step
   * (`Moved “Inbox” to “Planning”`) that undoes from either layout. A write
   * that fails, or a layout gone, keeps the mode open and says so.
   */
  async function finishTransfer(session: LayoutEditSession, incoming: IncomingTransfer): Promise<boolean> {
    const verb = incoming.copy ? 'copy' : 'move'
    const draft = get().working
    const saved = get().saved
    if (!draft || !saved || saved.id !== session.layoutId) return false
    const now = new Date()
    let sourceBefore: Layout | undefined
    let sourceAfter: Layout | undefined
    if (!incoming.copy) {
      sourceBefore = (await layoutRepository.get(incoming.sourceLayoutId).catch(() => undefined))?.layout
      if (!sourceBefore) {
        useUndoStore.getState().notify(`Layout “${incoming.sourceName}” is gone: “${incoming.name}” can’t move from it.`)
        return false
      }
      sourceAfter = { ...removeTabsKeepCell(sourceBefore, incoming.sourceTabIds), modifiedAt: now }
    }
    // The lists the session made that the draft doesn't show go first (as Done's).
    await pruneListsAmong(session.layoutId, session.createdLists, draft)
    const plan = transferListPlan(incoming, draft, sourceAfter ?? null)
    let written: TransferWritten | null
    try {
      written = await trackWrite(() => layoutRepository.transfer({
        target: { ...draft, modifiedAt: now },
        ...(sourceAfter ? { source: sourceAfter } : {}),
        reown: plan.reown,
        copies: listCopiesOf(plan.copy),
      }))
    } catch (err) {
      reportWriteFailure(`Couldn't ${verb} “${incoming.name}”.`, err)
      return false
    }
    if (!written) {
      useUndoStore.getState().notify(`A layout is gone: “${incoming.name}” wasn’t ${incoming.copy ? 'copied' : 'moved'}.`)
      return false
    }
    endSession()
    const target = written.target
    takeStored(sourceAfter ? [target, sourceAfter] : [target])
    await takeTransferLists(written.removed, plan.reown.length > 0 || written.copyIds.length > 0)
    const description = `${incoming.copy ? 'Copied' : 'Moved'} “${incoming.name}” to “${saved.name}”`
    const run: TransferRun = {
      description,
      target: { id: target.id, before: layoutBodyOf(saved), after: layoutBodyOf(target) },
      ...(sourceBefore && sourceAfter ? { source: { id: sourceBefore.id, before: layoutBodyOf(sourceBefore), after: layoutBodyOf(sourceAfter) } } : {}),
      reown: plan.reown,
      copyIds: written.copyIds,
      copyRows: null,
      removed: written.removed,
    }
    useUndoStore.getState().push({ description, undo: () => undoTransfer(run), redo: () => redoTransfer(run) }, true)
    return true
  }

  /** The rows a move's undo / redo writes: each of its layouts as stored now with `pick`'s body and the view state of now — `UndoGone` when one is gone, `UndoRefused` in the mode. */
  function transferRows(run: TransferRun, verb: 'undo' | 'redo', pick: 'before' | 'after'): { target: Layout; source?: Layout } {
    assertNoReplaceHold()
    if (get().editing) throw new UndoRefused(`Finish editing the layout to ${verb}: ${run.description}.`)
    const now = new Date()
    const rowAs = (part: TransferRunPart): Layout => {
      const current = storedRow(part.id)
      if (!current) throw new UndoGone(`Can’t ${verb}: ${run.description} — its layout is gone.`)
      return { ...withViewStateOf(withLayoutBody(current, part[pick]), current), modifiedAt: now }
    }
    const target = rowAs(run.target)
    return run.source ? { target, source: rowAs(run.source) } : { target }
  }

  /** A move's undo: the copies deleted, the lists handed over back with the source, the lists its writes removed back, both layouts as they were. */
  async function undoTransfer(run: TransferRun): Promise<void> {
    await settleLayoutWrites()
    const { target, source } = transferRows(run, 'undo', 'before')
    const copyRows = await trackWrite(() => layoutRepository.untransfer({
      target, ...(source ? { source } : {}), reown: run.reown, copyIds: run.copyIds, restore: run.removed,
    }))
    if (!copyRows) throw new UndoGone(`Can’t undo: ${run.description} — its layout is gone.`)
    run.copyRows = copyRows
    run.copyIds = []
    run.removed = []
    takeStored(source ? [target, source] : [target])
    await takeTransferLists([], true)
  }

  /** A move's redo: the copies put back, the lists handed over again, both layouts as after it. */
  async function redoTransfer(run: TransferRun): Promise<void> {
    await settleLayoutWrites()
    const { target, source } = transferRows(run, 'redo', 'after')
    const written = await trackWrite(() => layoutRepository.transfer({
      target, ...(source ? { source } : {}), reown: run.reown, copies: [], ...(run.copyRows ? { copyRows: run.copyRows } : {}),
    }))
    if (!written) throw new UndoGone(`Can’t redo: ${run.description} — its layout is gone.`)
    run.copyIds = written.copyIds
    run.copyRows = null
    run.removed = written.removed
    takeStored(source ? [written.target, source] : [written.target])
    await takeTransferLists(written.removed, true)
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
    resizePreview: null, structurePreview: null,
    editing: null,
    discardedLists: [],

    async enterEdit(opts) {
      const cellId = opts?.cellId ?? null
      if (get().editing) {
        if (cellId != null) get().selectEditCell(cellId)
        return true
      }
      if (!get().saved || refusedByReplaceHold()) return false
      if (!(await readyToEdit())) return false
      const { saved, working } = get()
      if (!saved || !working || get().editing || refusedByReplaceHold()) return get().editing != null
      clearForEdit()
      const selected = cellId != null && working.cells.some((c) => c.id === cellId) ? cellId : null
      beginSession({ layoutId: saved.id, selectedCellId: selected, undo: [], redo: [], createdLists: [] }, working)
      return true
    },

    selectEditCell(cellId, opts) {
      const { editing, working } = get()
      const arm = opts?.arm === true && cellId != null
      if (!editing || (editing.selectedCellId === cellId && (editing.moveArmed ?? false) === arm)) return
      if (cellId != null && !working?.cells.some((c) => c.id === cellId)) return
      set({ editing: { ...editing, selectedCellId: cellId, moveArmed: arm } })
    },

    disarmEditMove() {
      const { editing } = get()
      if (editing?.moveArmed) set({ editing: { ...editing, moveArmed: false } })
    },

    tapEdit(target) {
      const { editing } = get()
      // Widgets in hand (Move / Copy to layout): a slot takes them, a card (anywhere on it) joins them as tabs.
      if (editing?.incoming && !incomingPlaced(get().working, editing.incoming)) {
        if (!get().placeIncoming({ kind: 'cell', cellId: target.cellId })) return { kind: 'disarm' }
        return { kind: 'place', cellId: get().editing?.selectedCellId ?? target.cellId }
      }
      const outcome = tapOutcome({ selectedCellId: editing?.selectedCellId ?? null, moveArmed: editing?.moveArmed ?? false }, target)
      if (!editing) return outcome
      switch (outcome.kind) {
        // A tap only selects: a move is armed by the toolbar's Move (or Space), never by a tap.
        case 'select': get().selectEditCell(outcome.cellId); break
        case 'disarm': get().disarmEditMove(); break
        case 'menu': get().selectEditCell(outcome.cellId); break
        case 'move':
          if (!get().moveEditCard(outcome.from, { kind: 'cell', cellId: outcome.to })) get().disarmEditMove()
          break
        case 'join':
          if (!get().moveEditCard(outcome.from, { kind: 'cell', cellId: outcome.into })) get().disarmEditMove()
          break
        case 'swap':
          if (!get().moveEditCard(outcome.from, { kind: 'swap', cellId: outcome.with })) get().disarmEditMove()
          break
      }
      return outcome
    },

    moveEditCard(cellId, target) {
      const first = get().working?.cells.find((c) => c.id === cellId)?.tabs[0]
      if (!first) return false
      const changed = edit((layout, genId) => movePanel(layout, cellId, target, genId), 'Moved cell')
      const after = get().working
      const holder = changed && after ? findTab(after, first.id)?.cellId : undefined
      if (holder != null) get().selectEditCell(holder)
      return changed
    },

    setCellArea(cellId, area) {
      const changed = edit((layout, genId) => setCellArea(layout, cellId, area, genId), 'Stretched cell')
      keepEditSelection()
      return changed
    },

    stretchCell(cellId, direction) {
      const working = get().working
      const area = working ? stretchedArea(working, cellId, direction) : null
      return area != null && get().setCellArea(cellId, area)
    },

    swapCells(aId, bId) {
      return edit((layout) => swapCells(layout, aId, bId), 'Swapped cells')
    },

    undoEdit() {
      const { editing, working } = get()
      const before = editing?.undo.at(-1)
      if (!editing || !working || !before) return
      mode.mergeKey = null
      const next = withViewStateOf(withLayoutBody(working, before), working)
      const selectedCellId = next.cells.some((c) => c.id === editing.selectedCellId) ? editing.selectedCellId : null
      set({
        working: next,
        editing: { ...editing, selectedCellId, moveArmed: false, undo: editing.undo.slice(0, -1), redo: [...editing.redo, layoutBodyOf(working)] },
        resizePreview: null, structurePreview: null,
      })
    },

    redoEdit() {
      const { editing, working } = get()
      const after = editing?.redo.at(-1)
      if (!editing || !working || !after) return
      mode.mergeKey = null
      const next = withViewStateOf(withLayoutBody(working, after), working)
      const selectedCellId = next.cells.some((c) => c.id === editing.selectedCellId) ? editing.selectedCellId : null
      set({
        working: next,
        editing: { ...editing, selectedCellId, moveArmed: false, undo: [...editing.undo, layoutBodyOf(working)], redo: editing.redo.slice(0, -1) },
        resizePreview: null, structurePreview: null,
      })
    },

    async finishEdit() {
      const { editing: session, working } = get()
      if (!session || !working) return session == null
      if (refusedByReplaceHold()) return false
      if (session.incoming && incomingPlaced(working, session.incoming)) return finishTransfer(session, session.incoming)
      endSession()
      // The lists it made that the draft doesn't show go first: the commit's
      // write would take them into its undo step, which would bring back
      // lists no layout ever showed.
      await pruneListsAmong(session.layoutId, session.createdLists, working)
      const { working: draft, saved } = get()
      if (!draft || !saved || saved.id !== session.layoutId || refusedByReplaceHold()) return true
      if (!layoutStructureEqual(draft, saved)) {
        commitEdit(saved, { ...draft, modifiedAt: new Date() }, `Edited layout “${saved.name}”`, {})
      } else if (!layoutBodyEqual(draft, saved)) {
        await writeDraftView(draft)
      }
      return true
    },

    cancelEdit() {
      const { editing: session, working, saved } = get()
      if (!session || !working || !saved) return
      const incoming = session.incoming
      if (incoming) {
        // Move / Copy to layout: back to the source, nothing written (a layout made for it deleted again).
        get().discardEdit()
        void get().load(incoming.sourceLayoutId).then(() => {
          if (incoming.madeLayout && get().activeLayoutId !== session.layoutId) void get().delete(session.layoutId)
        })
        return
      }
      const changed = layoutEditChanged(get())
      endSession()
      set({ working: saved, resizePreview: null, structurePreview: null })
      if (!changed) {
        void pruneListsAmong(session.layoutId, session.createdLists, saved)
        return
      }
      const offer: RestoreOffer = { session, draft: layoutBodyOf(working), saved: layoutBodyOf(saved) }
      mode.restore = offer
      set({ discardedLists: session.createdLists })
      useUndoStore.getState().notify('Layout changes discarded', {
        action: { label: 'Restore', run: () => { void restoreEdit(offer) } },
        onEnd: () => dropRestore(offer),
      })
    },

    discardEdit() {
      const { editing: session, saved } = get()
      if (!session || !saved) return
      endSession()
      set({ working: saved, resizePreview: null, structurePreview: null })
      void pruneListsAmong(session.layoutId, session.createdLists, saved)
    },

    leaveEdit() {
      get().discardEdit()
    },

    dropEdit() {
      if (!get().editing) return
      if (layoutEditChanged(get())) useUndoStore.getState().notify('Edit layout closed: its changes weren’t saved.')
      get().discardEdit()
    },

    askLeaveEdit() {
      if (!get().editing) return Promise.resolve(true)
      const name = get().saved?.name ?? 'the layout'
      mode.question ??= useUIStore.getState().askChoice({
        title: `Save changes to layout “${name}”?`,
        message: 'Your changes will be lost if you don’t save.',
        confirmLabel: 'Save',
        discardLabel: 'Discard',
        cancelLabel: 'Keep editing',
      }).then(async (answer): Promise<boolean> => {
        if (answer === 'confirm') return get().finishEdit()
        if (answer === 'discard') get().discardEdit()
        return get().editing == null
      }).finally(() => { mode.question = null })
      return mode.question
    },

    endEditForReplace() {
      // Its lists' ids may name other lists in the new data: nothing is deleted.
      mode.restore = null
      if (get().discardedLists.length > 0) set({ discardedLists: [] })
      if (!get().editing) return
      const changed = layoutEditChanged(get())
      endSession()
      set({ working: get().saved, resizePreview: null, structurePreview: null })
      if (changed) useUndoStore.getState().notify('Edit layout closed: its changes weren’t saved.')
    },

    noteEditList(listDefinitionId) {
      const { editing } = get()
      if (!editing || editing.createdLists.includes(listDefinitionId)) return
      set({ editing: { ...editing, createdLists: [...editing.createdLists, listDefinitionId] } })
    },

    async transferTo(to, what, copy) {
      if (refusedByReplaceHold()) return false
      if (get().editing) {
        // A card's Move / Copy cell to layout: its draft first (Save / Discard / Keep editing).
        if (layoutEditChanged(get())) {
          if (!(await get().askLeaveEdit())) return false
        } else {
          get().leaveEdit()
        }
      }
      if (layoutLeaveAsks() && !(await leaveLayout())) return false
      quitLayoutEditors()
      if (!(await readyToLeave())) return false
      const source = get().saved
      if (!source || refusedByReplaceHold()) return false
      const carried = carriedTabs(source, what, source, idGenFor(source))
      if (!carried) {
        useUndoStore.getState().notify(`That widget isn’t in layout “${source.name}” any more.`)
        return false
      }
      const titles = carried.sourceTabIds.map((id) => tabName(source, id))
      const name = cardName({ tabs: carried.tabs }, titles)
      let targetId: number
      if (typeof to === 'number') {
        if (to === source.id || !get().layouts.some((l) => l.id === to)) return false
        if (!(await openLayout(to))) return false
        targetId = to
      } else {
        const id = await get().createLayout(to.newName)
        if (id == null) return false
        targetId = id
      }
      const target = get().working
      if (!target || target.id !== targetId || get().editing || refusedByReplaceHold()) return false
      const landing = carriedTabs(source, what, target, idGenFor(target))
      if (!landing) return false
      clearForEdit()
      const incoming: IncomingTransfer = {
        copy,
        sourceLayoutId: source.id,
        sourceName: source.name,
        ...landing,
        name,
        ...(typeof to === 'number' ? {} : { madeLayout: true }),
      }
      beginSession({ layoutId: targetId, selectedCellId: null, undo: [], redo: [], createdLists: [], incoming }, target)
      return true
    },

    placeIncoming(target) {
      const { editing, working } = get()
      const incoming = editing?.incoming
      if (!incoming || !working || incomingPlaced(working, incoming)) return false
      let cellId: string | null = null
      const changed = edit((layout, genId) => {
        const placed = placeIncomingTabs(layout, incoming.tabs, target, genId, incoming.activeTabId)
        cellId = placed.cellId
        return placed.layout
      }, `Placed “${incoming.name}”`)
      const holder = cellId as string | null
      if (!changed || holder == null) return false
      get().selectEditCell(holder)
      return true
    },

    init() {
      if (get().hydrated) return openActive()
      // Concurrent first calls (StrictMode's double effects) share the page
      // load's first open, so its unshown lists are pruned once.
      firstInit ??= openActive().finally(() => { firstInit = null })
      return firstInit
    },

    async load(id) {
      if (refusedByReplaceHold()) return
      if (id !== get().activeLayoutId) {
        // An open editor holding changes (Edit list, a widget editor, the
        // layout edit mode) asks first (`editor-leave`); the mode with none closes.
        if (layoutLeaveAsks() && !(await leaveLayout())) return
        quitLayoutEditors()
      }
      if (id === get().activeLayoutId || await readyToLeave()) await openLayout(id)
    },

    async createLayout(name) {
      const clean = cleanName(name)
      if (!clean || refusedByReplaceHold()) return null
      if (layoutLeaveAsks() && !(await leaveLayout())) return null
      quitLayoutEditors()
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
      // The layout edit mode: `working` is a draft; Done writes the layout.
      if (refusedByReplaceHold() || get().editing) return false
      return (await commit(saved)).ok
    },

    async duplicateLayout(name) {
      const clean = cleanName(name)
      const openId = get().saved?.id
      if (!clean || openId == null || refusedByReplaceHold()) return null
      if (layoutLeaveAsks() && !(await leaveLayout())) return null
      quitLayoutEditors()
      if (!(await readyToLeave())) return null
      // The lists it shows are copied for the new layout; the originals stay
      // with the layout they came from.
      await useListDefinitionStore.getState().ensureLoaded()
      // Read only now: an editor's Save (the question above) and a retried
      // write changed the open layout, and the copy is of the layout as it is.
      const source = get().saved
      if (!source || source.id !== openId || refusedByReplaceHold()) return null
      const now = new Date()
      const { id: _from, sortOrder: _order, ...body } = source
      void _from
      void _order
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
      if (!clean || refusedByReplaceHold() || refusedWhileEditing()) return false
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
      if (id === get().activeLayoutId || get().editing) {
        if (layoutLeaveAsks() && !(await leaveLayout())) return false
        quitLayoutEditors()
      }
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
      if (refusedByReplaceHold() || refusedWhileEditing()) return false
      const before = get().layouts.map((l) => l.id)
      if (!(await applyOrder(orderedIds))) return false
      const after = get().layouts.map((l) => l.id)
      if (after.length === before.length && after.every((id, i) => id === before[i])) return true
      // Undo / redo throw on a failed write: the entry stays, to try again.
      const apply = (ids: readonly number[]) => async () => {
        assertNoReplaceHold()
        if (get().editing) throw new UndoRefused(`Finish editing the layout first: ${description}.`)
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
      edit((layout) => closeTab(layout, tabId), (before) => `Removed “${tabName(before, tabId)}”`)
    },

    removeWidget(tabId) {
      edit((layout) => removeTabKeepCell(layout, tabId), (before) => `Removed “${tabName(before, tabId)}”`)
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

    insertTrackBeside(cellId, side) {
      let newCellId: string | null = null
      edit((layout, genId) => {
        const result = insertTrackBeside(layout, cellId, side, genId)
        newCellId = result.cellId
        return result.layout
      }, side === 'top' || side === 'bottom' ? 'Inserted row' : 'Inserted column')
      return newCellId
    },

    mergeCells(aId, bId) {
      return edit((layout) => mergeCells(layout, aId, bId), 'Merged cells')
    },

    insertTrackAt(axis, index, from, through) {
      let newCellId: string | null = null
      edit((layout, genId) => {
        const result = insertTrackAt(layout, axis, index, genId, from, through)
        newCellId = result.cellId
        return result.layout
      }, axis === 'rows' ? 'Inserted row' : 'Inserted column')
      return newCellId
    },

    removeTrack(axis, index) {
      const changed = edit((layout, genId) => removeTrack(layout, axis, index, genId), axis === 'rows' ? 'Removed row' : 'Removed column')
      keepEditSelection()
      return changed
    },

    mergeTrackInto(axis, index, into) {
      const changed = edit((layout, genId) => mergeTrackInto(layout, axis, index, into, genId), axis === 'rows' ? 'Merged rows' : 'Merged columns')
      keepEditSelection()
      return changed
    },

    evenTracks(axis) {
      return resize((layout) => evenTracks(layout, axis), () => [axis])
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

    setStructurePreview(preview) {
      if (preview === get().structurePreview) return
      if (preview && get().editing == null) return
      set({ structurePreview: preview })
    },

    setEditContent(on) {
      const editing = get().editing
      if (!editing || (editing.showContent ?? false) === on) return
      set({ editing: { ...editing, showContent: on } })
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
