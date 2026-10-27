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

/** The headed parts of the merged sections (Tasks, Database). */
export type SettingsPartId =
  | 'task-defaults'
  | 'lenses'
  | 'eisenhower'
  | 'completed'
  | 'file-storage'
  | 'backups'
  | 'import-export'
  | 'data-integrity'

/** The section each part sits in. */
export const SETTINGS_PART_SECTION: Readonly<Record<SettingsPartId, SettingsSectionId>> = {
  'task-defaults': 'tasks',
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

/** A yes / no question some code is waiting on (`askConfirmation`). */
export interface ConfirmPrompt {
  title: string
  message: string
  confirmLabel: string
  /** Renders the confirm button with danger styling. */
  danger?: boolean
  /** Focus (so Enter) starts on Cancel instead of the confirm button. */
  cancelIsDefault?: boolean
}

interface PendingConfirmPrompt extends ConfirmPrompt {
  /** Unique per question asked (the host keys its dialog by it). */
  id: number
  resolve: (confirmed: boolean) => void
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
  editPopupMode: EditPopupMode
  bulkConfirmation: BulkConfirmation | null
  /**
   * Questions awaiting an answer, oldest first; `ConfirmPromptHost` shows the
   * first. Unlike `bulkConfirmation` the asker awaits the answer, and the host
   * is mounted outside the app shell, so it also works during startup.
   */
  confirmPrompts: PendingConfirmPrompt[]
  /**
   * The task dialog (`TaskDialog`): the tasks behind a dashboard number or a
   * person chip. `null` = closed.
   */
  taskDialog: TaskDialogPayload | null
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
   * click, a pick, Cycle lens and a reload put the lens back — a layout
   * switch doesn't.
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
  /** The section the Settings modal shows; kept while the app stays open. */
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
  /** A person's / tag's Edit… or Delete… from its menu (`EntityActionHost`); `null` = none. */
  entityAction: EntityAction | null

  selectOneTodo: (id: number) => void
  rangeSelectTodo: (id: number, orderedIds: number[]) => void
  setHoveredTodoId: (id: number | null) => void
  selectAll: (ids: number[]) => void
  /** Sets a list widget's selection (computed by `nextScopedSelection`). */
  setScopedSelection: (scope: string, selection: ScopedSelection) => void
  clearSelection: () => void
  showBulkConfirmation: (action: BulkConfirmation['action'], ids: number[], options?: Partial<Pick<BulkConfirmation, 'message' | 'title' | 'confirmLabel' | 'onConfirm'>>) => void
  clearBulkConfirmation: () => void
  /** Asks `prompt`; resolves true on confirm, false on cancel / Esc / backdrop. */
  askConfirmation: (prompt: ConfirmPrompt) => Promise<boolean>
  /** Answers the prompt on screen (the first in `confirmPrompts`). */
  answerConfirmation: (confirmed: boolean) => void
  openEditPopup: (todoId: number) => void
  openCreatePopup: () => void
  closeEditPopup: () => void
  /**
   * Opens the task dialog. Clears the selection, so a row's actions in the
   * dialog act on that row only.
   */
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
  openQuickAdd: (seed?: string | { rawTitle?: string; defaults?: FilterDefaults; source?: string }) => void
  closeQuickAdd: () => void
  setQuickAddDraft: (draft: QuickAddDraftSeed | null) => void
  showRecentlyCreated: (todoId: number) => void
  clearRecentlyCreated: () => void
  /**
   * Opens Settings, on `target` (a section, or a part of one) when given;
   * `focus` names a control there to focus (its `data-settings-focus`).
   */
  openSettings: (target?: SettingsTarget, focus?: string) => void
  closeSettings: () => void
  setSettingsSection: (target: SettingsTarget) => void
  /** The part scroll was shown: forget it. */
  clearSettingsPart: () => void
  /** Opens the email check-in dialog with `personIds` ticked (none by default) and an optional `notice`. */
  openCheckinDialog: (personIds?: readonly number[], notice?: string) => void
  closeCheckinDialog: () => void
  /** Opens the check-in reply import dialog (closing the check-in dialog). */
  openCheckinImport: () => void
  closeCheckinImport: () => void
  openEntityAction: (action: EntityAction) => void
  closeEntityAction: () => void
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
  editPopupMode: null,
  bulkConfirmation: null,
  confirmPrompts: [],
  taskDialog: null,
  filterPanelOpen: false,
  filterPanelFocusKey: 0,
  lensLifted: false,
  isFilterSheetOpen: false,
  filterSheetFocusSearch: false,
  listEditor: null,
  quickAddOpen: false,
  quickAddDraft: null,
  recentlyCreated: null,
  settingsOpen: false,
  settingsSection: 'appearance',
  settingsPart: null,
  settingsFocus: null,
  checkinDialog: null,
  checkinImportOpen: false,
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
    return new Promise<boolean>((resolve) => {
      set({ confirmPrompts: [...get().confirmPrompts, { ...prompt, id: ++lastPromptId, resolve }] })
    })
  },

  answerConfirmation(confirmed) {
    const [first, ...rest] = get().confirmPrompts
    if (!first) return
    set({ confirmPrompts: rest })
    first.resolve(confirmed)
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
    if (!target) {
      set({ settingsOpen: true })
      return
    }
    const { section, part } = resolveSettingsTarget(target)
    // A control is focused only on the way to a part (the modal clears both once there).
    set({ settingsOpen: true, settingsSection: section, settingsPart: part, settingsFocus: part ? (focus ?? null) : null })
  },

  closeSettings() {
    set({ settingsOpen: false, settingsPart: null, settingsFocus: null })
  },

  setSettingsSection(target) {
    const { section, part } = resolveSettingsTarget(target)
    set({ settingsSection: section, settingsPart: part, settingsFocus: null })
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

  openCheckinImport() {
    set({ checkinImportOpen: true, checkinDialog: null })
  },

  closeCheckinImport() {
    set({ checkinImportOpen: false })
  },

  openEntityAction(action) {
    set({ entityAction: action })
  },

  closeEntityAction() {
    set({ entityAction: null })
  },
}))
