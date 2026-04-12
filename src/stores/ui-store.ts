import { create } from 'zustand'
import { AppView, Priority } from '../models'
import type { ListSortBy } from '../models'

type EditPopupMode = 'edit' | 'create' | null

export type AttributeFilter =
  | { type: 'priority'; priority: Priority }
  | { type: 'person'; personId: number; personName: string }
  | { type: 'tag'; tagId: number; tagName: string; tagColor?: string }
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

interface UIState {
  activeView: AppView
  selectedTodoId: number | null
  selectedTodoIds: Set<number>
  selectionAnchorId: number | null
  selectionFocusId: number | null
  focusedTodoId: number | null
  editPopupMode: EditPopupMode
  bulkConfirmation: BulkConfirmation | null
  collapsedParents: Set<number>
  listSortBy: ListSortBy
  inlineCreateAfterId: number | null
  clipboardTodoIds: number[]
  clipboardSourceProjectId: number | null
  filteredListPopup: FilteredListPopup | null
  /** Pending canvas target from command palette navigation */
  pendingCanvasTarget: { x: number; y: number } | null
  /** Mobile filter sheet open state */
  isFilterSheetOpen: boolean
  /** Project navigator panel open state */
  isProjectNavigatorOpen: boolean
  /** Minimap collapsed state */
  isMinimapOpen: boolean

  setActiveView: (view: AppView) => void
  selectTodo: (id: number | null) => void
  selectOneTodo: (id: number) => void
  toggleSelectTodo: (id: number) => void
  rangeSelectTodo: (id: number, orderedIds: number[]) => void
  setFocusedTodo: (id: number | null) => void
  selectAll: (ids: number[]) => void
  clearSelection: () => void
  showBulkConfirmation: (action: BulkConfirmation['action'], ids: number[], options?: Partial<Pick<BulkConfirmation, 'message' | 'title' | 'confirmLabel' | 'cancelLabel' | 'skipIds' | 'onConfirm'>>) => void
  clearBulkConfirmation: () => void
  openEditPopup: (todoId: number) => void
  openCreatePopup: () => void
  closeEditPopup: () => void
  toggleCollapseParent: (todoId: number) => void
  setListSortBy: (sortBy: ListSortBy) => void
  triggerInlineCreate: (afterTodoId: number) => void
  clearInlineCreate: () => void
  cutTasks: (todoIds: number[], sourceProjectId: number | null) => void
  clearClipboard: () => void
  showFilteredList: (x: number, y: number, filter: AttributeFilter) => void
  hideFilteredList: () => void
  setPendingCanvasTarget: (target: { x: number; y: number } | null) => void
  toggleFilterSheet: () => void
  setFilterSheetOpen: (open: boolean) => void
  toggleProjectNavigator: () => void
  toggleMinimap: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  activeView: AppView.Canvas,
  selectedTodoId: null,
  selectedTodoIds: new Set<number>(),
  selectionAnchorId: null,
  selectionFocusId: null,
  focusedTodoId: null,
  editPopupMode: null,
  bulkConfirmation: null,
  collapsedParents: new Set<number>(),
  listSortBy: 'priority' as ListSortBy,
  inlineCreateAfterId: null,
  clipboardTodoIds: [],
  clipboardSourceProjectId: null,
  filteredListPopup: null,
  pendingCanvasTarget: null,
  isFilterSheetOpen: false,
  isProjectNavigatorOpen: false,
  isMinimapOpen: localStorage.getItem('minimapOpen') !== 'false',

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

  setListSortBy(sortBy: ListSortBy) {
    set({ listSortBy: sortBy })
  },

  toggleCollapseParent(todoId: number) {
    const next = new Set(get().collapsedParents)
    if (next.has(todoId)) {
      next.delete(todoId)
    } else {
      next.add(todoId)
    }
    set({ collapsedParents: next })
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

  toggleFilterSheet() {
    set({ isFilterSheetOpen: !get().isFilterSheetOpen })
  },

  setFilterSheetOpen(open: boolean) {
    set({ isFilterSheetOpen: open })
  },

  toggleProjectNavigator() {
    set({ isProjectNavigatorOpen: !get().isProjectNavigatorOpen })
  },

  toggleMinimap() {
    const next = !get().isMinimapOpen
    localStorage.setItem('minimapOpen', String(next))
    set({ isMinimapOpen: next })
  },
}))
