import type { RefObject } from 'react'
import { create } from 'zustand'
import { registerModuleReset } from '../utils/module-reset'
import type { TaskDialogPayload } from './task-dialog-payload'
import type { FilterDefaults } from '../utils/filter-defaults'
import type { ScopedSelection } from '../utils/scoped-selection'
import type { EisenhowerQuadrant } from '../models/workspace-layout'

type EditPopupMode = 'edit' | 'create' | null

/** The sections of the Settings modal (and the mobile Settings page), in order. */
export type SettingsSectionId =
  | 'appearance'
  | 'tasks'
  | 'entities'
  | 'database'
  | 'shortcuts'
  | 'about'

/** The headed parts of the merged sections (Tasks, Database, Appearance). */
export type SettingsPartId =
  | 'new-tasks'
  | 'lists-and-rows'
  | 'lenses'
  | 'eisenhower'
  | 'completed'
  | 'file-storage'
  | 'backups'
  | 'import-export'
  | 'data-integrity'
  | 'theme-and-lists'
  | 'ambience'

/** The section each part sits in. */
export const SETTINGS_PART_SECTION: Readonly<Record<SettingsPartId, SettingsSectionId>> = {
  'theme-and-lists': 'appearance',
  ambience: 'appearance',
  'new-tasks': 'tasks',
  'lists-and-rows': 'tasks',
  lenses: 'tasks',
  eisenhower: 'tasks',
  completed: 'tasks',
  'file-storage': 'database',
  backups: 'database',
  'import-export': 'database',
  'data-integrity': 'database',
}

/** The `data-settings-focus` of pane `q`'s name field in Settings › Tasks › Eisenhower. */
export function eisenhowerPaneFocus(q: EisenhowerQuadrant): string {
  return `eisenhower-pane-${q}`
}

/** The `data-settings-focus` of lens `lensId`'s row (its head button) in Settings › Tasks › Lenses. */
export function lensFocus(lensId: string): string {
  return `lens-${lensId}`
}

/** Every section id (a stored section is read back only as one of these). */
const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = ['appearance', 'tasks', 'entities', 'database', 'shortcuts', 'about']

/** Where Settings opens before any section was shown in this browser. */
export const FIRST_SETTINGS_SECTION: SettingsSectionId = 'appearance'

/**
 * The browser's last shown Settings section, kept in `localStorage` (a
 * per-browser convenience, not data: outside Dexie, like the sync file's
 * bookkeeping) so Settings reopens on it after a reload.
 */
export const SETTINGS_SECTION_KEY = 'todo2-settings-section'

/** The section Settings last showed in this browser (`FIRST_SETTINGS_SECTION` when none, or unreadable). */
export function readLastSettingsSection(): SettingsSectionId {
  try {
    const stored = localStorage.getItem(SETTINGS_SECTION_KEY)
    return SETTINGS_SECTION_IDS.find((id) => id === stored) ?? FIRST_SETTINGS_SECTION
  } catch {
    return FIRST_SETTINGS_SECTION
  }
}

/** Keeps `section` as the one Settings reopens on; storage that refuses it is ignored (it is a convenience). */
function rememberSettingsSection(section: SettingsSectionId): void {
  try {
    localStorage.setItem(SETTINGS_SECTION_KEY, section)
  } catch {
    // Private mode / blocked storage: Settings opens on Appearance next time.
  }
}

/** Where Settings can open: a section, or a part of one (shown scrolled to it). */
export type SettingsTarget = SettingsSectionId | SettingsPartId

/** A target's section, and its part when it names one. */
export function resolveSettingsTarget(target: SettingsTarget): { section: SettingsSectionId; part: SettingsPartId | null } {
  if (Object.hasOwn(SETTINGS_PART_SECTION, target)) {
    const part = target as SettingsPartId
    return { section: SETTINGS_PART_SECTION[part], part }
  }
  return { section: target as SettingsSectionId, part: null }
}

/** A person or tag picked from its menu (a task row's avatar / tag, a picker's option), and what to do with it (`entityAction`). */
export interface EntityAction {
  kind: 'person' | 'tag'
  id: number
  /** `edit` = its editor, opened on it; `delete` = the delete confirm. */
  action: 'edit' | 'delete'
}

/** What Quick Add (or the editor it hands off to) starts from; see `quickAddDraft`. */
export interface QuickAddDraftSeed {
  rawTitle: string
  defaults?: FilterDefaults
  source?: string
}

export interface BulkConfirmation {
  action: 'delete' | 'complete' | 'uncomplete' | 'custom'
  ids: number[]
  message?: string        // custom dialog message
  title?: string          // custom dialog title
  confirmLabel?: string   // custom confirm button text
  onConfirm?: () => void  // custom confirm handler (used with action: 'custom')
}

/**
 * What a row's follow-up popover (`FollowupPopoverHost`) is open on. Hosted
 * outside the row, so it outlives a row that leaves its list once the task
 * is marked followed up.
 */
export interface FollowupPopoverRequest {
  todoId: number
  /** The trigger's place when it opened: the popover stays there while the row moves or goes. */
  anchor: { left: number; top: number; right: number; bottom: number }
  /** The row's pill / flag that opened it: the toggle. */
  triggerRef: RefObject<HTMLElement | null>
  /** What has focus on open (`FollowupPopover`'s `initialFocus`). */
  initialFocus: 'followedUp' | 'next'
  /** The popover level (`usePopoverLevel`) where the row is: 2 in a dialog. */
  level: number
}

/**
 * A task row's notes popover or checklist (popover, or the phone's sheet),
 * shown by `RowPopoverHost` outside the row: a write in it can take the row
 * out of its list or group, and it stays open (cr31 T1).
 */
export interface RowPopoverRequest {
  kind: 'notes' | 'subtasks'
  todoId: number
  /** The row's cell / count that opened it (or the row, `anchorIsInside: false`): its anchor while the row is there, and the toggle. */
  anchorRef: RefObject<HTMLElement | null>
  anchorIsInside: boolean
  /** The checklist as the phone's bottom sheet. */
  sheet: boolean
  /** The checklist opens on its add field (the menu's Add subtask…). */
  focusAdd: boolean
  /** The popover level (`usePopoverLevel`) where the row is: 2 in a dialog. */
  level: number
  onOpenDetail?: (todoId: number) => void
}

/**
 * What the task picker (`TaskPickerHost`) is open for: a parent for a task
 * becoming a subtask, or another task for a subtask to move to (cr28).
 */
export type TaskPickerRequest =
  | { kind: 'make-subtask'; todoId: number }
  | { kind: 'move-subtask'; subtaskId: number }

/** A yes / no question some code is waiting on (`askConfirmation`), or a three-way one (`askChoice`). */
export interface ConfirmPrompt {
  title: string
  message: string
  confirmLabel: string
  /** The cancel button's label (default Cancel). */
  cancelLabel?: string
  /**
   * A third answer, `discard` (Save / Discard / Keep editing): its label, on
   * a quiet danger button at the start of the row. Only with `askChoice`.
   */
  discardLabel?: string
  /** Renders the confirm button with danger styling. */
  danger?: boolean
  /** Focus (so Enter) starts on Cancel instead of the confirm button. */
  cancelIsDefault?: boolean
}

/** A prompt's answer: its confirm button, its discard button (`discardLabel`), or cancel / Esc / backdrop. */
export type PromptAnswer = 'confirm' | 'discard' | 'cancel'

interface PendingConfirmPrompt extends ConfirmPrompt {
  /** Unique per question asked (the host keys its dialog by it). */
  id: number
  resolve: (answer: PromptAnswer) => void
}

/** The last question's `id`. */
let lastPromptId = 0
registerModuleReset(() => { lastPromptId = 0 })

/**
 * Unsaved work in a Settings section that Settings must settle before it
 * closes or shows another section — a lens's filter edits
 * (`lens-draft-store` registers it when it loads; nothing else can hold
 * such work before then).
 */
export interface SettingsLeaveGuard {
  /** The part the work is in (its section: `SETTINGS_PART_SECTION`); Settings opens there while the work is pending. */
  part: SettingsPartId
  /** The control there to focus when Settings opens on the work (its `data-settings-focus`), if any. */
  focus?: () => string | null
  /** There is unsaved work now. */
  pending: () => boolean
  /** Asks about it (Save / Discard / Keep editing); resolves whether to go on. */
  settle: () => Promise<boolean>
}

/** Wiring, not state: registered once by its module, never reset. */
let leaveGuard: SettingsLeaveGuard | null = null

/** Registers the guard `closeSettings`, `setSettingsSection` and `openSettings` ask first. */
export function registerSettingsLeaveGuard(guard: SettingsLeaveGuard): void {
  leaveGuard = guard
}

interface UIState {
  selectedTodoId: number | null
  selectedTodoIds: Set<number>
  selectionAnchorId: number | null
  selectionFocusId: number | null
  /**
   * The list widget (tab id) the selection belongs to, or `null` for a
   * selection made on another surface. Selection lives in one widget at a
   * time; its anchor and keyboard cursor are row occurrences
   * (`utils/scoped-selection.ts`), since a task can show more than once.
   */
  selectionScope: string | null
  selectionAnchorKey: string | null
  selectionCursorKey: string | null
  /** Todo currently hovered on any surface — drives cross-surface hover highlighting. */
  hoveredTodoId: number | null
  /**
   * The list tab (tab id) last pressed or focused in, if any: the palette's
   * Zoom List In / Out act on it (`services/list-zoom`).
   */
  activeListTabId: string | null
  editPopupMode: EditPopupMode
  bulkConfirmation: BulkConfirmation | null
  /**
   * Questions awaiting an answer, oldest first; `ConfirmPromptHost` shows the
   * first. Unlike `bulkConfirmation` the asker awaits the answer, and the host
   * is mounted outside the app shell, so it also works during startup.
   */
  confirmPrompts: PendingConfirmPrompt[]
  /**
   * The task dialog (`TaskDialog`): the tasks behind a glance widget's number or a
   * person chip. `null` = closed.
   */
  taskDialog: TaskDialogPayload | null
  /** The task picker on screen (Make subtask of… / Move to another task…), or null. */
  taskPicker: TaskPickerRequest | null
  followupPopover: FollowupPopoverRequest | null
  /** A row's notes popover or checklist (`RowPopoverHost`). */
  rowPopover: RowPopoverRequest | null
  /**
   * The top bar's filtered-tasks panel (desktop): the screen filter's tasks
   * dropped from the filter tray, which edits them live.
   */
  filterPanelOpen: boolean
  /** Counts the requests to focus the panel (each open, the palette's command while it is open). */
  filterPanelFocusKey: number
  /**
   * The top bar's lens is lifted for now (the lens control's glasses):
   * every widget shows what the chips keep; the pick stays. A second
   * click, a pick, Cycle lens, a reload and a data replace bringing another
   * pick put the lens back — a layout switch doesn't.
   */
  lensLifted: boolean
  /** Mobile filter sheet open state */
  isFilterSheetOpen: boolean
  /** The filter sheet was opened from a search button: focus its search box. */
  filterSheetFocusSearch: boolean
  /**
   * The open Edit list surface (the workspace's side popover, the phone's
   * half sheet): the list it edits and the list tab it was opened for (it
   * sits beside that tab's panel). One at a time.
   */
  listEditor: { listDefinitionId: number; tabId: string } | null
  /** The Number tab whose editor (Edit number…, D26 P5) is open, beside the Number; one at a time. */
  numberEditorTabId: string | null
  /**
   * QuickAddBar open state. Owned here so the global `Ctrl+Space` shortcut
   * + the FAB + any future caller can dispatch open/close without
   * prop-drilling. `openCreatePopup` remains the entry point for the
   * deliberate "I want all the fields" path and for the bar's "Open full
   * editor →" handoff.
   */
  quickAddOpen: boolean
  /**
   * In-progress draft seed for the QuickAddBar / TaskEditPopup create-mode
   * handoff. Used in three ways:
   * 1. `openQuickAdd(seed)` writes `{ rawTitle: seed }` so the bar can
   *    pre-fill its title field on open.
   * 2. The bar's Details / Tab handoff stashes the in-progress draft here,
   *    then opens `TaskEditPopup` create mode which reads it on mount and
   *    pre-fills title + parser-derived metadata. The popup clears the
   *    draft via `closeEditPopup` on its close.
   * 3. `defaults` carries pre-resolved task metadata that overrides the
   *    active filter when seeding a new task — used by the list
   *    widget's "+ Add task" affordance to plumb the list's predicate
   *    through to QuickAddBar's submit handler. When absent, the submit
   *    handler falls back to `useFilterStore.getState().filters`.
   * 4. `source` names where the task is being added (e.g. an Eisenhower
   *    quadrant): the bar shows `Adding to <source>`.
   */
  quickAddDraft: QuickAddDraftSeed | null
  /**
   * Most recently created task — drives the transient `RecentTaskPill`
   * overlay. The pill renders for ~5s after creation so the user can click
   * to open the editor or one-click put it in focus before it fades.
   * `key` is a fresh value (Date.now) so React can remount the pill — and
   * restart its CSS animation — when a new task is created while the
   * previous pill is still visible.
   */
  recentlyCreated: { todoId: number; key: number } | null
  /**
   * The desktop Settings modal. It sits over the workspace and never changes
   * the route, so opening it never triggers the unsaved-layout prompt.
   */
  settingsOpen: boolean
  /**
   * The section the Settings modal shows: the last one shown, across reloads
   * (`SETTINGS_SECTION_KEY`; Appearance the first time). An explicit target
   * (`openSettings(section)`, a deep link to a part) shows its own.
   */
  settingsSection: SettingsSectionId
  /** A part of it to scroll to (a deep link such as the storage pill's); cleared once shown. */
  settingsPart: SettingsPartId | null
  /**
   * A control in that part to focus once shown — the one whose
   * `data-settings-focus` it names (e.g. an Eisenhower pane's name field);
   * set only with a part, cleared with it (and when Settings closes).
   */
  settingsFocus: string | null
  /**
   * The email check-in dialog (`CheckinDialog`): the people ticked when it
   * opened (none from the general command) and `notice`: why a one-click
   * send opened it instead (shown in its status line). `null` = closed.
   */
  checkinDialog: { personIds: number[]; notice?: string } | null
  /** The check-in reply import dialog (`CheckinImportDialog`) is open. */
  checkinImportOpen: boolean
  /**
   * The person the import was opened for (a person's `Paste reply from …`):
   * who replied when the reply's footer names nobody of yours. `null`: none.
   */
  checkinImportPersonId: number | null
  /** A person's / tag's Edit… or Delete… from its menu (`EntityActionHost`); `null` = none. */
  entityAction: EntityAction | null

  selectOneTodo: (id: number) => void
  rangeSelectTodo: (id: number, orderedIds: number[]) => void
  setHoveredTodoId: (id: number | null) => void
  setActiveListTab: (tabId: string | null) => void
  selectAll: (ids: number[]) => void
  /** Sets a list widget's selection (computed by `nextScopedSelection`). */
  setScopedSelection: (scope: string, selection: ScopedSelection) => void
  clearSelection: () => void
  showBulkConfirmation: (action: BulkConfirmation['action'], ids: number[], options?: Partial<Pick<BulkConfirmation, 'message' | 'title' | 'confirmLabel' | 'onConfirm'>>) => void
  clearBulkConfirmation: () => void
  /** Asks `prompt`; resolves true on confirm, false on cancel / Esc / backdrop. */
  askConfirmation: (prompt: ConfirmPrompt) => Promise<boolean>
  /** Asks `prompt` with its third answer (`discardLabel`); resolves which was picked. */
  askChoice: (prompt: ConfirmPrompt) => Promise<PromptAnswer>
  /** Answers the prompt on screen (the first in `confirmPrompts`): true = confirm, false = cancel. */
  answerConfirmation: (answer: boolean | PromptAnswer) => void
  openEditPopup: (todoId: number) => void
  openCreatePopup: () => void
  closeEditPopup: () => void
  /**
   * Opens the task dialog. Clears the selection, so a row's actions in the
   * dialog act on that row only.
   */
  openTaskPicker: (request: TaskPickerRequest) => void
  closeTaskPicker: () => void
  openFollowupPopover: (request: FollowupPopoverRequest) => void
  openRowPopover: (request: RowPopoverRequest) => void
  closeRowPopover: () => void
  closeFollowupPopover: () => void
  showTaskDialog: (payload: TaskDialogPayload) => void
  hideTaskDialog: () => void
  /**
   * Opens the filtered-tasks panel and asks it for the focus (again, when
   * it is open already). Clears the selection, as the task dialog does.
   */
  openFilterPanel: () => void
  closeFilterPanel: () => void
  /** Lifts the top bar's lens for now, or puts it back (`lensLifted`). */
  setLensLifted: (lifted: boolean) => void
  toggleFilterSheet: () => void
  setFilterSheetOpen: (open: boolean) => void
  /** Opens the mobile filter sheet with its search box focused. */
  openFilterSheetSearch: () => void
  openListEditor: (listDefinitionId: number, tabId: string) => void
  /** Closes Edit list at once, whatever its list's state (an unsaved list keeps its draft). */
  closeListEditor: () => void
  openNumberEditor: (tabId: string) => void
  closeNumberEditor: () => void
  openQuickAdd: (seed?: string | { rawTitle?: string; defaults?: FilterDefaults; source?: string }) => void
  closeQuickAdd: () => void
  setQuickAddDraft: (draft: QuickAddDraftSeed | null) => void
  showRecentlyCreated: (todoId: number) => void
  clearRecentlyCreated: () => void
  /**
   * Opens Settings, on `target` (a section, or a part of one) when given;
   * `focus` names a control there to focus (its `data-settings-focus`).
   * Already open with unsaved work (`SettingsLeaveGuard`) in its section, a
   * target in another section asks first. With unsaved work it doesn't show
   * (a lens draft kept by `hideSettings`) it opens on that work instead —
   * Tasks › Lenses, the drafted lens focused — whatever the target.
   */
  openSettings: (target?: SettingsTarget, focus?: string) => void
  /**
   * Closes Settings — every close (Esc, ×, the backdrop) comes here. With
   * unsaved work (a lens draft, `SettingsLeaveGuard`) it asks first and
   * closes after Save / Discard; Keep editing leaves Settings as it was.
   */
  closeSettings: () => void
  /**
   * Closes Settings at once, keeping a lens draft for its next open — the
   * phone width, where the modal isn't shown (nothing is lost, nothing asked).
   */
  hideSettings: () => void
  /**
   * Shows another section (or part). Leaving a section with unsaved work in
   * it (a lens draft, `SettingsLeaveGuard`) asks first, as `closeSettings` does.
   */
  setSettingsSection: (target: SettingsTarget) => void
  /** The part scroll was shown: forget it. */
  clearSettingsPart: () => void
  /** Opens the email check-in dialog with `personIds` ticked (none by default) and an optional `notice`. */
  openCheckinDialog: (personIds?: readonly number[], notice?: string) => void
  closeCheckinDialog: () => void
  /**
   * Opens the check-in reply import dialog (closing the check-in dialog);
   * `personId`: the person it is opened for (`checkinImportPersonId`).
   */
  openCheckinImport: (opts?: { personId?: number }) => void
  closeCheckinImport: () => void
  openEntityAction: (action: EntityAction) => void
  closeEntityAction: () => void
}

/**
 * Showing `section` would leave unsaved work: Settings is open on the
 * guard's section with work pending, and `section` is another.
 */
function leavesUnsavedWork(ui: Pick<UIState, 'settingsOpen' | 'settingsSection'>, section: SettingsSectionId): boolean {
  if (!leaveGuard) return false
  const own = SETTINGS_PART_SECTION[leaveGuard.part]
  return ui.settingsOpen && ui.settingsSection === own && section !== own && leaveGuard.pending()
}

/**
 * Where Settings must open to show unsaved work it doesn't show now — a
 * lens draft kept while it was closed (`hideSettings`, the phone width) —
 * or null: no such work, or Settings already open on its section.
 */
function unsavedWorkOutOfSight(ui: Pick<UIState, 'settingsOpen' | 'settingsSection'>): Pick<UIState, 'settingsSection' | 'settingsPart' | 'settingsFocus'> | null {
  if (!leaveGuard || !leaveGuard.pending()) return null
  const section = SETTINGS_PART_SECTION[leaveGuard.part]
  if (ui.settingsOpen && ui.settingsSection === section) return null
  return { settingsSection: section, settingsPart: leaveGuard.part, settingsFocus: leaveGuard.focus?.() ?? null }
}

/** Runs `go` once the guard lets Settings go on: at once without unsaved work (`needed` false), else after its answer. */
function afterSettled(needed: boolean, go: () => void): void {
  if (!needed || !leaveGuard) go()
  else void leaveGuard.settle().then((ok) => { if (ok) go() })
}

export const useUIStore = create<UIState>((set, get) => ({
  selectedTodoId: null,
  selectedTodoIds: new Set<number>(),
  selectionAnchorId: null,
  selectionFocusId: null,
  selectionScope: null,
  selectionAnchorKey: null,
  selectionCursorKey: null,
  hoveredTodoId: null,
  activeListTabId: null,
  editPopupMode: null,
  bulkConfirmation: null,
  confirmPrompts: [],
  taskDialog: null,
  taskPicker: null,
  followupPopover: null,
  rowPopover: null,
  filterPanelOpen: false,
  filterPanelFocusKey: 0,
  lensLifted: false,
  isFilterSheetOpen: false,
  filterSheetFocusSearch: false,
  listEditor: null,
  numberEditorTabId: null,
  quickAddOpen: false,
  quickAddDraft: null,
  recentlyCreated: null,
  settingsOpen: false,
  settingsSection: readLastSettingsSection(),
  settingsPart: null,
  settingsFocus: null,
  checkinDialog: null,
  checkinImportOpen: false,
  checkinImportPersonId: null,
  entityAction: null,

  selectOneTodo(id: number) {
    set({ selectedTodoIds: new Set([id]), selectionAnchorId: id, selectionFocusId: id, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
  },

  rangeSelectTodo(id: number, orderedIds: number[]) {
    const anchor = get().selectionAnchorId
    if (anchor == null) {
      set({ selectedTodoIds: new Set([id]), selectionAnchorId: id, selectionFocusId: id, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
      return
    }
    const anchorIdx = orderedIds.indexOf(anchor)
    const targetIdx = orderedIds.indexOf(id)
    if (anchorIdx === -1 || targetIdx === -1) {
      set({ selectedTodoIds: new Set([id]), selectionAnchorId: id, selectionFocusId: id, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
      return
    }
    const start = Math.min(anchorIdx, targetIdx)
    const end = Math.max(anchorIdx, targetIdx)
    const rangeIds = orderedIds.slice(start, end + 1)
    set({ selectedTodoIds: new Set(rangeIds), selectionFocusId: id, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
  },

  setHoveredTodoId(id: number | null) {
    if (get().hoveredTodoId === id) return
    set({ hoveredTodoId: id })
  },

  setActiveListTab(tabId: string | null) {
    if (get().activeListTabId === tabId) return
    set({ activeListTabId: tabId })
  },

  selectAll(ids: number[]) {
    if (ids.length === 0) return
    set({ selectedTodoIds: new Set(ids), selectionAnchorId: ids[0], selectionFocusId: ids[ids.length - 1], selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
  },

  setScopedSelection(scope, { ids, anchorKey, cursorKey, cursorTodoId }) {
    set({
      selectedTodoIds: new Set(ids),
      selectionScope: scope,
      selectionAnchorKey: anchorKey,
      selectionCursorKey: cursorKey,
      selectionAnchorId: cursorTodoId,
      selectionFocusId: cursorTodoId,
    })
  },

  clearSelection() {
    set({ selectedTodoIds: new Set(), selectionAnchorId: null, selectionFocusId: null, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
  },

  showBulkConfirmation(action, ids, options) {
    set({ bulkConfirmation: { action, ids, ...options } })
  },

  clearBulkConfirmation() {
    set({ bulkConfirmation: null })
  },

  askConfirmation(prompt) {
    // Two buttons: a discard label would offer an answer it can't give.
    const yesNo: ConfirmPrompt = { ...prompt }
    delete yesNo.discardLabel
    return get().askChoice(yesNo).then((answer) => answer === 'confirm')
  },

  askChoice(prompt) {
    return new Promise<PromptAnswer>((resolve) => {
      set({ confirmPrompts: [...get().confirmPrompts, { ...prompt, id: ++lastPromptId, resolve }] })
    })
  },

  answerConfirmation(answer) {
    const [first, ...rest] = get().confirmPrompts
    if (!first) return
    set({ confirmPrompts: rest })
    first.resolve(answer === true ? 'confirm' : answer === false ? 'cancel' : answer)
  },

  openEditPopup(todoId: number) {
    set({ selectedTodoId: todoId, editPopupMode: 'edit' })
  },

  openCreatePopup() {
    set({ selectedTodoId: null, editPopupMode: 'create' })
  },

  closeEditPopup() {
    // Also clear the QuickAddBar handoff draft. The bar's "Open full editor →"
    // path stashes a draft in `quickAddDraft` for the popup to read on mount;
    // popping the popup discards any unsaved seed so the next create-popup
    // open starts clean.
    set({ selectedTodoId: null, editPopupMode: null, quickAddDraft: null })
  },

  openTaskPicker(request) {
    set({ taskPicker: request })
  },

  closeTaskPicker() {
    set({ taskPicker: null })
  },

  openRowPopover(request) {
    set({ rowPopover: request })
  },

  closeRowPopover() {
    set({ rowPopover: null })
  },

  openFollowupPopover(request) {
    set({ followupPopover: request })
  },

  closeFollowupPopover() {
    set({ followupPopover: null })
  },

  showTaskDialog(payload) {
    set({
      taskDialog: payload,
      selectedTodoIds: new Set(), selectionAnchorId: null, selectionFocusId: null,
      selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null,
    })
  },

  hideTaskDialog() {
    set({ taskDialog: null })
  },

  openFilterPanel() {
    set({
      filterPanelOpen: true,
      filterPanelFocusKey: get().filterPanelFocusKey + 1,
      selectedTodoIds: new Set(), selectionAnchorId: null, selectionFocusId: null,
      selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null,
    })
  },

  setLensLifted(lifted) {
    if (get().lensLifted !== lifted) set({ lensLifted: lifted })
  },

  closeFilterPanel() {
    if (get().filterPanelOpen) set({ filterPanelOpen: false })
  },

  toggleFilterSheet() {
    set({ isFilterSheetOpen: !get().isFilterSheetOpen, filterSheetFocusSearch: false })
  },

  setFilterSheetOpen(open: boolean) {
    set({ isFilterSheetOpen: open, filterSheetFocusSearch: false })
  },

  openFilterSheetSearch() {
    set({ isFilterSheetOpen: true, filterSheetFocusSearch: true })
  },

  openListEditor(listDefinitionId, tabId) {
    set({ listEditor: { listDefinitionId, tabId } })
  },

  closeListEditor() {
    if (get().listEditor === null) return
    set({ listEditor: null })
  },

  openNumberEditor(tabId) {
    set({ numberEditorTabId: tabId })
  },

  closeNumberEditor() {
    if (get().numberEditorTabId === null) return
    set({ numberEditorTabId: null })
  },

  openQuickAdd(seed) {
    let draft: QuickAddDraftSeed | null = null
    if (typeof seed === 'string') {
      draft = { rawTitle: seed }
    } else if (seed && (seed.rawTitle != null || seed.defaults || seed.source)) {
      draft = {
        rawTitle: seed.rawTitle ?? '',
        ...(seed.defaults ? { defaults: seed.defaults } : {}),
        ...(seed.source ? { source: seed.source } : {}),
      }
    }
    set({ quickAddOpen: true, quickAddDraft: draft })
  },

  closeQuickAdd() {
    set({ quickAddOpen: false, quickAddDraft: null })
  },

  setQuickAddDraft(draft) {
    set({ quickAddDraft: draft })
  },

  showRecentlyCreated(todoId) {
    set({ recentlyCreated: { todoId, key: Date.now() } })
  },

  clearRecentlyCreated() {
    if (get().recentlyCreated === null) return
    set({ recentlyCreated: null })
  },

  openSettings(target, focus) {
    // Edit list belongs to the workspace under the modal: it closes (an
    // unsaved list keeps its draft).
    get().closeListEditor()
    get().closeNumberEditor()
    // Unsaved work Settings doesn't show (a lens draft kept at phone width):
    // it opens on that, whatever was asked — never with the work out of sight.
    const work = unsavedWorkOutOfSight(get())
    if (work) {
      rememberSettingsSection(work.settingsSection)
      set({ settingsOpen: true, ...work })
      return
    }
    if (!target) {
      set({ settingsOpen: true })
      return
    }
    const { section, part } = resolveSettingsTarget(target)
    // A control is focused only on the way to a part (the modal clears both once there).
    const go = () => {
      rememberSettingsSection(section)
      set({ settingsOpen: true, settingsSection: section, settingsPart: part, settingsFocus: part ? (focus ?? null) : null })
    }
    afterSettled(leavesUnsavedWork(get(), section), go)
  },

  closeSettings() {
    const close = () => set({ settingsOpen: false, settingsPart: null, settingsFocus: null })
    afterSettled(get().settingsOpen && (leaveGuard?.pending() ?? false), close)
  },

  hideSettings() {
    set({ settingsOpen: false, settingsPart: null, settingsFocus: null })
  },

  setSettingsSection(target) {
    const { section, part } = resolveSettingsTarget(target)
    afterSettled(leavesUnsavedWork(get(), section), () => {
      rememberSettingsSection(section)
      set({ settingsSection: section, settingsPart: part, settingsFocus: null })
    })
  },

  clearSettingsPart() {
    if (get().settingsPart !== null || get().settingsFocus !== null) set({ settingsPart: null, settingsFocus: null })
  },

  openCheckinDialog(personIds, notice) {
    set({ checkinDialog: { personIds: [...new Set(personIds ?? [])], ...(notice ? { notice } : {}) } })
  },

  closeCheckinDialog() {
    set({ checkinDialog: null })
  },

  openCheckinImport(opts) {
    set({ checkinImportOpen: true, checkinImportPersonId: opts?.personId ?? null, checkinDialog: null })
  },

  closeCheckinImport() {
    set({ checkinImportOpen: false, checkinImportPersonId: null })
  },

  openEntityAction(action) {
    set({ entityAction: action })
  },

  closeEntityAction() {
    set({ entityAction: null })
  },
}))
