import type { RefObject } from 'react'
import { create } from 'zustand'
import { registerModuleReset } from '../utils/module-reset'
import { closeOpenEditors, layoutLeaveAsks, leaveLayout, openOneEditor, quitLayoutEditors, registerEditorFields } from './editor-leave'
import type { TaskDialogPayload } from './task-dialog-payload'
import type { FilterDefaults } from '../utils/filter-defaults'
import type { ScopedSelection } from '../utils/scoped-selection'
import type { ReviewTabViewState } from '../models/workspace-layout'
import type { TodoGroupBy, TodoSortBy, TodoSortDirection } from '../models/todo-sort-group'

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
  | 'rules'
  | 'new-lists'
  | 'completed'
  | 'file-storage'
  | 'backups'
  | 'import-export'
  | 'data-integrity'
  | 'theme'
  | 'task-rows'
  | 'ambience'

/** The section each part sits in. */
export const SETTINGS_PART_SECTION: Readonly<Record<SettingsPartId, SettingsSectionId>> = {
  theme: 'appearance',
  'task-rows': 'appearance',
  ambience: 'appearance',
  'new-tasks': 'tasks',
  rules: 'tasks',
  'new-lists': 'tasks',
  completed: 'tasks',
  'file-storage': 'database',
  backups: 'database',
  'import-export': 'database',
  'data-integrity': 'database',
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
/**
 * A layout action asked for from outside the top bar's layout controls (the
 * palette): `LayoutControls` takes it and runs it as its own tabs and picker
 * do — a switch through the same path as a tab's click, New layout… and
 * Duplicate layout… opening their name dialogs.
 */
export type LayoutRequest =
  | { kind: 'switch'; layoutId: number }
  | { kind: 'new' }
  | { kind: 'duplicate' }


/**
 * The widget open larger (`WidgetPopupHost`, `services/widget-popup`): a tab
 * of the open layout by id; the list a Number that follows a list shows
 * (`list`: the Number's tab id); or the popup review — a Review widget tied
 * to no layout tab (`REVIEW_POPUP_TAB_ID`).
 */
export type WidgetPopupTarget = { kind: 'tab'; tabId: string } | { kind: 'list'; tabId: string } | { kind: 'review' }

export interface QuickAddDraftSeed {
  rawTitle: string
  defaults?: FilterDefaults
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
/**
 * The popup task lists' group · sort pick (`ui-store.popupListPick`): what
 * the user picked in a task dialog or the filtered-tasks panel, shared by
 * all of them until a reload. A part not picked follows Settings' new-list
 * default; `sort` and `sortDirection` are picked together.
 */
export interface PopupListPick {
  grouping?: TodoGroupBy
  sort?: TodoSortBy
  sortDirection?: TodoSortDirection
}

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
  /** Every popup task list's group · sort pick: in memory only, gone on a reload (`PopupListPick`). */
  popupListPick: PopupListPick
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
   * The check-in dialog (`CheckinDialog`): the people it was opened for
   * (listed first, the first of them selected). `null` = closed.
   */
  checkinDialog: { personIds: number[] } | null
  /** The check-in reply import dialog (`CheckinImportDialog`) is open. */
  checkinImportOpen: boolean
  /**
   * The person the import was opened for (the Review widget's Paste reply, while its filter names one person):
   * who replied when the reply's footer names nobody of yours. `null`: none.
   */
  checkinImportPersonId: number | null
  /** A person's / tag's Edit… or Delete… from its menu (`EntityActionHost`); `null` = none. */
  entityAction: EntityAction | null
  /** A layout action for `LayoutControls` to run (`LayoutRequest`); `null` = none waiting. */
  layoutRequest: LayoutRequest | null
  /** The widget open larger, one at a time (`WidgetPopupTarget`); `null` = none. Opened through `services/widget-popup`. */
  widgetPopup: WidgetPopupTarget | null
  /**
   * The popup review's view state — its rail's sort — kept here in memory
   * (it has no layout to save it in): Priority until changed, back to it on
   * a reload.
   */
  popupReviewView: ReviewTabViewState

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
  /** Picks a popup task list's grouping, or its sort with its direction, for every popup list until a reload. */
  pickPopupListView: (pick: PopupListPick) => void
  /**
   * Opens the filtered-tasks panel and asks it for the focus (again, when
   * it is open already). Clears the selection, as the task dialog does.
   */
  openFilterPanel: () => void
  closeFilterPanel: () => void
  toggleFilterSheet: () => void
  setFilterSheetOpen: (open: boolean) => void
  /** Opens the mobile filter sheet with its search box focused. */
  openFilterSheetSearch: () => void
  openListEditor: (listDefinitionId: number, tabId: string) => void
  /** Closes Edit list at once, whatever its list's state (an unsaved list keeps its draft). */
  closeListEditor: () => void
  openNumberEditor: (tabId: string) => void
  closeNumberEditor: () => void
  openQuickAdd: (seed?: string | { rawTitle?: string; defaults?: FilterDefaults }) => void
  closeQuickAdd: () => void
  setQuickAddDraft: (draft: QuickAddDraftSeed | null) => void
  showRecentlyCreated: (todoId: number) => void
  clearRecentlyCreated: () => void
  /** Opens Settings, on `target` (a section, or a part of one) when given. */
  openSettings: (target?: SettingsTarget) => void
  /** Closes Settings — every close (Esc, ×, the backdrop, the phone width) comes here. */
  closeSettings: () => void
  /** Shows another section (or part). */
  setSettingsSection: (target: SettingsTarget) => void
  /** The part scroll was shown: forget it. */
  clearSettingsPart: () => void
  /** Opens the check-in dialog for `personIds` (none by default). */
  openCheckinDialog: (personIds?: readonly number[]) => void
  closeCheckinDialog: () => void
  /**
   * Opens the check-in reply import dialog (closing the check-in dialog);
   * `personId`: the person it is opened for (`checkinImportPersonId`).
   */
  openCheckinImport: (opts?: { personId?: number }) => void
  closeCheckinImport: () => void
  openEntityAction: (action: EntityAction) => void
  closeEntityAction: () => void
  requestLayout: (request: LayoutRequest) => void
  clearLayoutRequest: () => void
  /** Shows `target` in the popup (replacing what it showed). */
  setWidgetPopup: (target: WidgetPopupTarget) => void
  closeWidgetPopup: () => void
  /** Changes the popup review's sort (`popupReviewView`). */
  patchPopupReviewView: (patch: Partial<ReviewTabViewState>) => void
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
  popupListPick: {},
  taskPicker: null,
  followupPopover: null,
  rowPopover: null,
  filterPanelOpen: false,
  filterPanelFocusKey: 0,
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
  checkinDialog: null,
  checkinImportOpen: false,
  checkinImportPersonId: null,
  entityAction: null,
  layoutRequest: null,
  widgetPopup: null,
  popupReviewView: {},

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

  pickPopupListView(pick) {
    set({ popupListPick: { ...get().popupListPick, ...pick } })
  },

  openFilterPanel() {
    set({
      filterPanelOpen: true,
      filterPanelFocusKey: get().filterPanelFocusKey + 1,
      selectedTodoIds: new Set(), selectionAnchorId: null, selectionFocusId: null,
      selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null,
    })
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
    const open = get().listEditor
    if (open?.listDefinitionId === listDefinitionId && open.tabId === tabId) return
    // An editor with changes is asked first (`editor-leave`): it is left only through Save / Discard. One
    // editor at a time, whatever its kind: any other closes.
    openOneEditor(() => set({ listEditor: { listDefinitionId, tabId } }))
  },

  closeListEditor() {
    if (get().listEditor === null) return
    set({ listEditor: null })
  },

  openNumberEditor(tabId) {
    if (get().numberEditorTabId === tabId) return
    openOneEditor(() => set({ numberEditorTabId: tabId }))
  },

  closeNumberEditor() {
    if (get().numberEditorTabId === null) return
    set({ numberEditorTabId: null })
  },

  openQuickAdd(seed) {
    let draft: QuickAddDraftSeed | null = null
    if (typeof seed === 'string') {
      draft = { rawTitle: seed }
    } else if (seed && (seed.rawTitle != null || seed.defaults)) {
      draft = {
        rawTitle: seed.rawTitle ?? '',
        ...(seed.defaults ? { defaults: seed.defaults } : {}),
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

  openSettings(target) {
    // Edit list and the widget editors belong to the workspace under the
    // modal: one holding changes asks first (Save / Discard / Keep editing,
    // `editor-leave`) and Settings opens once it was saved or discarded; an
    // unchanged one just closes — every kind (`closeOpenEditors`, the one roster).
    // Settings leaves the layout: the layout edit mode asks too, and with no
    // changes closes (`leaveLayout`).
    if (layoutLeaveAsks()) {
      void leaveLayout().then((left) => { if (left) get().openSettings(target) })
      return
    }
    quitLayoutEditors()
    closeOpenEditors()
    if (!target) {
      set({ settingsOpen: true })
      return
    }
    const { section, part } = resolveSettingsTarget(target)
    rememberSettingsSection(section)
    set({ settingsOpen: true, settingsSection: section, settingsPart: part })
  },

  closeSettings() {
    set({ settingsOpen: false, settingsPart: null })
  },

  setSettingsSection(target) {
    const { section, part } = resolveSettingsTarget(target)
    rememberSettingsSection(section)
    set({ settingsSection: section, settingsPart: part })
  },

  clearSettingsPart() {
    if (get().settingsPart !== null) set({ settingsPart: null })
  },

  openCheckinDialog(personIds) {
    set({ checkinDialog: { personIds: [...new Set(personIds ?? [])] } })
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
  requestLayout(request) {
    set({ layoutRequest: request })
  },
  clearLayoutRequest() {
    set({ layoutRequest: null })
  },
  setWidgetPopup(target) {
    set({ widgetPopup: target })
  },
  closeWidgetPopup() {
    if (get().widgetPopup === null) return
    set({ widgetPopup: null })
  },
  patchPopupReviewView(patch) {
    set({ popupReviewView: { ...get().popupReviewView, ...patch } })
  },
}))

// Edit list and the Number editor, on the one roster of open editors (`editor-leave`).
registerEditorFields(() => {
  const s = useUIStore.getState()
  s.closeListEditor()
  s.closeNumberEditor()
})
