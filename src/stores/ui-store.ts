import { create } from 'zustand'
import { AppView } from '../models'
import type { ListGroupBy, ListItemSortBy } from '../models'

type EditPopupMode = 'edit' | 'create' | null

export type AttributeFilter =
  | { type: 'person'; personId: number; personName: string }
  | { type: 'org'; orgId: number; orgName: string; orgColor?: string }

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

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

/**
 * Kind of floating canvas widget currently being dragged. Derived from the
 * React Flow node id prefix in `CanvasView.handleNodesChange` and stashed on
 * the UI store so the rails `DockOverlay` and the Phase 2 hit-test can observe
 * an in-flight float-dock gesture without plumbing refs through the tree.
 *
 * `'lens'` is the floating list widget — `ListInsetNode` on the canvas, the
 * `lens` slot kind on rails, and the `lens` arm of `FloatDescriptor`. The
 * React Flow node id prefix is still `inset-` (see `CanvasView.INSET_PREFIX`)
 * for DOM/test stability; `floatKindForNodeId` performs the prefix→kind
 * translation. `TaskSurfaceKey` separately uses `'inset'` and `'lens'` to
 * distinguish the floating list row's drag id from a rail-docked list row's
 * — those are distinct surfaces and live in `utils/task-dnd/ids.ts`.
 */
export type FloatDragKind = 'note' | 'calendar' | 'lens' | 'taskboard' | 'horizons'

export interface FloatDragState {
  kind: FloatDragKind
  id: number
}

interface UIState {
  activeView: AppView
  selectedTodoId: number | null
  selectedTodoIds: Set<number>
  selectionAnchorId: number | null
  selectionFocusId: number | null
  focusedTodoId: number | null
  /** Todo currently hovered on any surface — drives cross-surface hover highlighting. */
  hoveredTodoId: number | null
  editPopupMode: EditPopupMode
  bulkConfirmation: BulkConfirmation | null
  /** What the List view groups tasks by. `'none'` = flat list. */
  listGroupBy: ListGroupBy
  /** How the List view sorts tasks within each group (or across all when ungrouped). */
  listSortBy: ListItemSortBy
  inlineCreateAfterId: number | null
  clipboardTodoIds: number[]
  clipboardSourceProjectId: number | null
  filteredListPopup: FilteredListPopup | null
  /** Pending canvas target from command palette navigation */
  pendingCanvasTarget: { x: number; y: number } | null
  /** When set, ListView shows an "editing preset" banner with Save / Cancel actions. */
  editingListDefId: number | null
  editingListDefName: string | null
  /** Mobile filter sheet open state */
  isFilterSheetOpen: boolean
  /** Project navigator panel open state */
  isProjectNavigatorOpen: boolean
  /** Taskboard panel open state */
  isTaskboardOpen: boolean
  /**
   * Lists editor (`DashboardListsEditor`) open state. Owned here so any
   * component (canvas list widget's kind menu, rail lens slot, etc.) can
   * dispatch "open editor for def N" without prop-drilling. CanvasPage
   * subscribes and renders the modal when `listsEditorOpen` is true.
   */
  listsEditorOpen: boolean
  /** Optional def id to preselect + auto-expand the ConfigPanel for. */
  listsEditorInitialId: number | null
  /** Descriptor of the floating canvas widget currently being dragged, or null. */
  floatDrag: FloatDragState | null
  /**
   * Screen-reader announcement for float-dock drag gestures — mirrors the
   * `useRailsDragMonitor` announcer (rendered as its own `aria-live=polite`
   * region by `RailsFrame`). Empty string = silence. Set on drag start
   * (`Dragging <kind>`) and on successful dock (`Dropped in <zone>`); cleared
   * when the drag ends without a dock or is cancelled.
   */
  floatAnnouncement: string

  setActiveView: (view: AppView) => void
  selectTodo: (id: number | null) => void
  selectOneTodo: (id: number) => void
  toggleSelectTodo: (id: number) => void
  rangeSelectTodo: (id: number, orderedIds: number[]) => void
  setFocusedTodo: (id: number | null) => void
  setHoveredTodoId: (id: number | null) => void
  selectAll: (ids: number[]) => void
  clearSelection: () => void
  showBulkConfirmation: (action: BulkConfirmation['action'], ids: number[], options?: Partial<Pick<BulkConfirmation, 'message' | 'title' | 'confirmLabel' | 'cancelLabel' | 'skipIds' | 'onConfirm'>>) => void
  clearBulkConfirmation: () => void
  openEditPopup: (todoId: number) => void
  openCreatePopup: () => void
  closeEditPopup: () => void
  setListGroupBy: (groupBy: ListGroupBy) => void
  setListSortBy: (sortBy: ListItemSortBy) => void
  triggerInlineCreate: (afterTodoId: number) => void
  clearInlineCreate: () => void
  cutTasks: (todoIds: number[], sourceProjectId: number | null) => void
  clearClipboard: () => void
  showFilteredList: (x: number, y: number, filter: AttributeFilter) => void
  hideFilteredList: () => void
  setPendingCanvasTarget: (target: { x: number; y: number } | null) => void
  startEditingListDef: (id: number, name: string) => void
  clearEditingListDef: () => void
  toggleFilterSheet: () => void
  setFilterSheetOpen: (open: boolean) => void
  toggleProjectNavigator: () => void
  toggleTaskboard: () => void
  setFloatDrag: (next: FloatDragState | null) => void
  setFloatAnnouncement: (text: string) => void
  openListsEditor: (initialId?: number | null) => void
  closeListsEditor: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  activeView: AppView.Canvas,
  selectedTodoId: null,
  selectedTodoIds: new Set<number>(),
  selectionAnchorId: null,
  selectionFocusId: null,
  focusedTodoId: null,
  hoveredTodoId: null,
  editPopupMode: null,
  bulkConfirmation: null,
  listGroupBy: 'date' as ListGroupBy,
  listSortBy: 'manual' as ListItemSortBy,
  inlineCreateAfterId: null,
  clipboardTodoIds: [],
  clipboardSourceProjectId: null,
  filteredListPopup: null,
  pendingCanvasTarget: null,
  editingListDefId: null,
  editingListDefName: null,
  isFilterSheetOpen: false,
  isProjectNavigatorOpen: false,
  isTaskboardOpen: localStorage.getItem('taskboardOpen') !== 'false',
  listsEditorOpen: false,
  listsEditorInitialId: null,
  floatDrag: null,
  floatAnnouncement: '',

  setActiveView(view: AppView) {
    set({ activeView: view })
  },

  selectTodo(id: number | null) {
    set({ selectedTodoId: id })
  },

  selectOneTodo(id: number) {
    set({ selectedTodoIds: new Set([id]), selectionAnchorId: id, selectionFocusId: id, focusedTodoId: id })
  },

  toggleSelectTodo(id: number) {
    const next = new Set(get().selectedTodoIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    set({ selectedTodoIds: next, selectionAnchorId: id, selectionFocusId: id, focusedTodoId: id })
  },

  rangeSelectTodo(id: number, orderedIds: number[]) {
    const anchor = get().selectionAnchorId
    if (anchor == null) {
      set({ selectedTodoIds: new Set([id]), selectionAnchorId: id, selectionFocusId: id, focusedTodoId: id })
      return
    }
    const anchorIdx = orderedIds.indexOf(anchor)
    const targetIdx = orderedIds.indexOf(id)
    if (anchorIdx === -1 || targetIdx === -1) {
      set({ selectedTodoIds: new Set([id]), selectionAnchorId: id, selectionFocusId: id, focusedTodoId: id })
      return
    }
    const start = Math.min(anchorIdx, targetIdx)
    const end = Math.max(anchorIdx, targetIdx)
    const rangeIds = orderedIds.slice(start, end + 1)
    set({ selectedTodoIds: new Set(rangeIds), selectionFocusId: id, focusedTodoId: id })
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
    set({ selectedTodoIds: new Set(ids), selectionAnchorId: ids[0], selectionFocusId: ids[ids.length - 1], focusedTodoId: ids[0] })
  },

  clearSelection() {
    set({ selectedTodoIds: new Set(), selectionAnchorId: null, selectionFocusId: null, focusedTodoId: null })
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
    set({ selectedTodoId: null, editPopupMode: null })
  },

  setListGroupBy(groupBy: ListGroupBy) {
    set({ listGroupBy: groupBy })
  },

  setListSortBy(sortBy: ListItemSortBy) {
    set({ listSortBy: sortBy })
  },

  triggerInlineCreate(afterTodoId: number) {
    set({ inlineCreateAfterId: afterTodoId })
  },

  clearInlineCreate() {
    set({ inlineCreateAfterId: null })
  },

  cutTasks(todoIds: number[], sourceProjectId: number | null) {
    set({ clipboardTodoIds: todoIds, clipboardSourceProjectId: sourceProjectId })
  },

  clearClipboard() {
    set({ clipboardTodoIds: [], clipboardSourceProjectId: null })
  },

  showFilteredList(x: number, y: number, filter: AttributeFilter) {
    set({ filteredListPopup: { x, y, filter } })
  },

  hideFilteredList() {
    set({ filteredListPopup: null })
  },

  setPendingCanvasTarget(target: { x: number; y: number } | null) {
    set({ pendingCanvasTarget: target })
  },

  startEditingListDef(id: number, name: string) {
    set({ editingListDefId: id, editingListDefName: name })
  },

  clearEditingListDef() {
    set({ editingListDefId: null, editingListDefName: null })
  },

  toggleFilterSheet() {
    set({ isFilterSheetOpen: !get().isFilterSheetOpen })
  },

  setFilterSheetOpen(open: boolean) {
    set({ isFilterSheetOpen: open })
  },

  toggleProjectNavigator() {
    set({ isProjectNavigatorOpen: !get().isProjectNavigatorOpen })
  },

  toggleTaskboard() {
    const next = !get().isTaskboardOpen
    localStorage.setItem('taskboardOpen', String(next))
    set({ isTaskboardOpen: next })
  },

  setFloatDrag(next) {
    const cur = get().floatDrag
    if (next === null && cur === null) return
    if (next && cur && next.kind === cur.kind && next.id === cur.id) return
    set({ floatDrag: next })
  },

  setFloatAnnouncement(text) {
    if (get().floatAnnouncement === text) return
    set({ floatAnnouncement: text })
  },

  openListsEditor(initialId) {
    set({ listsEditorOpen: true, listsEditorInitialId: initialId ?? null })
  },

  closeListsEditor() {
    set({ listsEditorOpen: false, listsEditorInitialId: null })
  },
}))
