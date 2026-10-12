import { create } from 'zustand'
import type { FilterDefaults } from '../utils/filter-defaults'
import type { ScopedSelection } from '../utils/scoped-selection'

type EditPopupMode = 'edit' | 'create' | null

/** The sections of the Settings modal (and the mobile Settings page), in order. */
export type SettingsSectionId =
  | 'appearance'
  | 'task-defaults'
  | 'entities'
  | 'completed'
  | 'file-storage'
  | 'backups'
  | 'import-export'
  | 'data-integrity'
  | 'shortcuts'
  | 'about'

export type AttributeFilter =
  | { type: 'person'; personId: number; personName: string }

export interface FilteredListPopup {
  x: number
  y: number
  filter: AttributeFilter
}

export interface BulkConfirmation {
  action: 'delete' | 'complete' | 'uncomplete' | 'custom'
  ids: number[]
  message?: string        // custom dialog message
  title?: string          // custom dialog title
  confirmLabel?: string   // custom confirm button text
  cancelLabel?: string    // custom cancel button text
  skipIds?: number[]      // if provided, cancel completes/acts on these IDs instead of doing nothing
  onConfirm?: () => void  // custom confirm handler (used with action: 'custom')
}

interface UIState {
  selectedTodoId: number | null
  selectedTodoIds: Set<number>
  selectionAnchorId: number | null
  selectionFocusId: number | null
  focusedTodoId: number | null
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
  filteredListPopup: FilteredListPopup | null
  /** Mobile filter sheet open state */
  isFilterSheetOpen: boolean
  /** The filter sheet was opened from a search button: focus its search box. */
  filterSheetFocusSearch: boolean
  /**
   * Lists editor (`DashboardListsEditor`) open state. Owned here so any
   * component (a list tab's menu, Settings, etc.) can dispatch "open editor
   * for def N" without prop-drilling. WorkspacePage subscribes and renders
   * the modal when `listsEditorOpen` is true.
   */
  listsEditorOpen: boolean
  /** Optional def id to preselect + auto-expand the ConfigPanel for. */
  listsEditorInitialId: number | null
  /**
   * Direct list-editor dialog id — when non-null, `<StandaloneListEditor>`
   * mounts the per-list editor dialog *without* the surrounding Lists
   * manager modal. Drives the "Edit list" entry from a list tab's menu.
   * The Lists manager's
   * own row-click → P2 dialog-on-modal flow keeps using the
   * `listsEditorOpen` + `listsEditorInitialId` pair above; the two paths
   * are deliberately distinct so the surfaces don't stack.
   */
  listEditorDialogId: number | null
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
  quickAddDraft: { rawTitle: string; defaults?: FilterDefaults } | null
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

  selectTodo: (id: number | null) => void
  selectOneTodo: (id: number) => void
  toggleSelectTodo: (id: number) => void
  rangeSelectTodo: (id: number, orderedIds: number[]) => void
  setFocusedTodo: (id: number | null) => void
  setHoveredTodoId: (id: number | null) => void
  selectAll: (ids: number[]) => void
  /** Sets a list widget's selection (computed by `nextScopedSelection`). */
  setScopedSelection: (scope: string, selection: ScopedSelection) => void
  clearSelection: () => void
  showBulkConfirmation: (action: BulkConfirmation['action'], ids: number[], options?: Partial<Pick<BulkConfirmation, 'message' | 'title' | 'confirmLabel' | 'cancelLabel' | 'skipIds' | 'onConfirm'>>) => void
  clearBulkConfirmation: () => void
  openEditPopup: (todoId: number) => void
  openCreatePopup: () => void
  closeEditPopup: () => void
  showFilteredList: (x: number, y: number, filter: AttributeFilter) => void
  hideFilteredList: () => void
  toggleFilterSheet: () => void
  setFilterSheetOpen: (open: boolean) => void
  /** Opens the mobile filter sheet with its search box focused. */
  openFilterSheetSearch: () => void
  openListsEditor: (initialId?: number | null) => void
  closeListsEditor: () => void
  openListEditorDialog: (id: number) => void
  closeListEditorDialog: () => void
  openQuickAdd: (seed?: string | { rawTitle?: string; defaults?: FilterDefaults }) => void
  closeQuickAdd: () => void
  setQuickAddDraft: (draft: { rawTitle: string; defaults?: FilterDefaults } | null) => void
  showRecentlyCreated: (todoId: number) => void
  clearRecentlyCreated: () => void
  /** Opens the Settings modal on `section`, or on the last section viewed. */
  openSettings: (section?: SettingsSectionId) => void
  closeSettings: () => void
  setSettingsSection: (section: SettingsSectionId) => void
}

export const useUIStore = create<UIState>((set, get) => ({
  selectedTodoId: null,
  selectedTodoIds: new Set<number>(),
  selectionAnchorId: null,
  selectionFocusId: null,
  focusedTodoId: null,
  selectionScope: null,
  selectionAnchorKey: null,
  selectionCursorKey: null,
  hoveredTodoId: null,
  editPopupMode: null,
  bulkConfirmation: null,
  filteredListPopup: null,
  isFilterSheetOpen: false,
  filterSheetFocusSearch: false,
  listsEditorOpen: false,
  listsEditorInitialId: null,
  listEditorDialogId: null,
  quickAddOpen: false,
  quickAddDraft: null,
  recentlyCreated: null,
  settingsOpen: false,
  settingsSection: 'appearance',

  selectTodo(id: number | null) {
    set({ selectedTodoId: id })
  },

  selectOneTodo(id: number) {
    set({ selectedTodoIds: new Set([id]), selectionAnchorId: id, selectionFocusId: id, focusedTodoId: id, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
  },

  toggleSelectTodo(id: number) {
    const next = new Set(get().selectedTodoIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    set({ selectedTodoIds: next, selectionAnchorId: id, selectionFocusId: id, focusedTodoId: id, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
  },

  rangeSelectTodo(id: number, orderedIds: number[]) {
    const anchor = get().selectionAnchorId
    if (anchor == null) {
      set({ selectedTodoIds: new Set([id]), selectionAnchorId: id, selectionFocusId: id, focusedTodoId: id, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
      return
    }
    const anchorIdx = orderedIds.indexOf(anchor)
    const targetIdx = orderedIds.indexOf(id)
    if (anchorIdx === -1 || targetIdx === -1) {
      set({ selectedTodoIds: new Set([id]), selectionAnchorId: id, selectionFocusId: id, focusedTodoId: id, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
      return
    }
    const start = Math.min(anchorIdx, targetIdx)
    const end = Math.max(anchorIdx, targetIdx)
    const rangeIds = orderedIds.slice(start, end + 1)
    set({ selectedTodoIds: new Set(rangeIds), selectionFocusId: id, focusedTodoId: id, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
  },

  setFocusedTodo(id: number | null) {
    set({ focusedTodoId: id })
  },

  setHoveredTodoId(id: number | null) {
    if (get().hoveredTodoId === id) return
    set({ hoveredTodoId: id })
  },

  selectAll(ids: number[]) {
    if (ids.length === 0) return
    set({ selectedTodoIds: new Set(ids), selectionAnchorId: ids[0], selectionFocusId: ids[ids.length - 1], focusedTodoId: ids[0], selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
  },

  setScopedSelection(scope, { ids, anchorKey, cursorKey, cursorTodoId }) {
    set({
      selectedTodoIds: new Set(ids),
      selectionScope: scope,
      selectionAnchorKey: anchorKey,
      selectionCursorKey: cursorKey,
      selectionAnchorId: cursorTodoId,
      selectionFocusId: cursorTodoId,
      focusedTodoId: cursorTodoId,
    })
  },

  clearSelection() {
    set({ selectedTodoIds: new Set(), selectionAnchorId: null, selectionFocusId: null, focusedTodoId: null, selectionScope: null, selectionAnchorKey: null, selectionCursorKey: null })
  },

  showBulkConfirmation(action, ids, options) {
    set({ bulkConfirmation: { action, ids, ...options } })
  },

  clearBulkConfirmation() {
    set({ bulkConfirmation: null })
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

  showFilteredList(x: number, y: number, filter: AttributeFilter) {
    set({ filteredListPopup: { x, y, filter } })
  },

  hideFilteredList() {
    set({ filteredListPopup: null })
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

  openListsEditor(initialId) {
    set({ listsEditorOpen: true, listsEditorInitialId: initialId ?? null })
  },

  closeListsEditor() {
    set({ listsEditorOpen: false, listsEditorInitialId: null })
  },

  openListEditorDialog(id) {
    set({ listEditorDialogId: id })
  },

  closeListEditorDialog() {
    set({ listEditorDialogId: null })
  },

  openQuickAdd(seed) {
    let draft: { rawTitle: string; defaults?: FilterDefaults } | null = null
    if (typeof seed === 'string') {
      draft = { rawTitle: seed }
    } else if (seed && (seed.rawTitle != null || seed.defaults)) {
      draft = { rawTitle: seed.rawTitle ?? '', ...(seed.defaults ? { defaults: seed.defaults } : {}) }
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

  openSettings(section) {
    set({ settingsOpen: true, ...(section ? { settingsSection: section } : {}) })
  },

  closeSettings() {
    set({ settingsOpen: false })
  },

  setSettingsSection(section) {
    set({ settingsSection: section })
  },
}))
