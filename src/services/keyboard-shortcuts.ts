/**
 * Single source of truth for global keyboard shortcuts.
 *
 * Both `hooks/use-keyboard-shortcuts.ts` (dispatcher) and
 * `components/settings/KeyboardShortcutsModal.tsx` (help modal) import from
 * here, so adding a shortcut means adding one row in this file.
 *
 * The dispatcher walks SINGLE_BINDINGS / SEQUENCE_BINDINGS via `matchChord`.
 * The modal renders by category from `getShortcutDocSections()`.
 */

import { useUIStore } from '../stores/ui-store'
import { useTodoStore } from '../stores/todo-store'
import { useUndoStore } from '../stores/undo-store'
import { pasteTasksAt } from './clipboard'
import { bySortOrder } from '../utils/sort-order'

export type ShortcutCategory = 'general' | 'navigation' | 'task' | 'notes'

export const SHORTCUT_CATEGORIES: ReadonlyArray<{ id: ShortcutCategory; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'task', label: 'Task Editing' },
  { id: 'notes', label: 'Notes' },
]

export interface ShortcutCallbacks {
  openPalette: () => void
  closePalette: () => void
  navigate: (path: string) => void
  createFloatingNote?: () => void
  openShortcutsModal?: () => void
  fitView?: () => void
  toggleProjectNavigator?: () => void
}

export interface ShortcutCtx {
  e: KeyboardEvent
  callbacks: ShortcutCallbacks
}

/**
 * A keyboard chord. `key` is matched against `e.key.toLowerCase()` (or `e.code`
 * if `useCode` is set). Modifier flags default to `false` (strict no-modifier).
 * `shiftAny` lets a chord match either shift state — useful for keys whose
 * shift state varies by layout (`?`) or where the handler branches internally
 * on shift (arrow keys, Home/End).
 */
export interface ChordSpec {
  key: string
  useCode?: boolean
  mod?: boolean
  shift?: boolean
  alt?: boolean
  shiftAny?: boolean
}

export interface ModalRow {
  category: ShortcutCategory
  /** Raw label string. Modal calls `formatShortcut` on this at render time. */
  label: string
  description: string
}

export interface SingleBinding {
  chord: ChordSpec
  /** When set, the modal renders this row in the given category. */
  modalRow?: ModalRow
  /** Allow the binding to fire while a text input has focus. Default false. */
  allowInInput?: boolean
  /** Skip when the edit popup is open. Default false. */
  blockedByEditPopup?: boolean
  handler: (ctx: ShortcutCtx) => void | Promise<void>
}

export interface SequenceBinding {
  /** Lowercase first key (no modifiers). */
  prefix: string
  /** Lowercase second key (no modifiers). */
  key: string
  modalRow: ModalRow
  handler: (ctx: ShortcutCtx) => void | Promise<void>
}

export function matchChord(e: KeyboardEvent, c: ChordSpec): boolean {
  const mod = e.ctrlKey || e.metaKey
  if ((c.mod ?? false) !== mod) return false
  if (!c.shiftAny && (c.shift ?? false) !== e.shiftKey) return false
  if ((c.alt ?? false) !== e.altKey) return false
  const value = c.useCode ? e.code : e.key
  return value.toLowerCase() === c.key.toLowerCase()
}

// ── Shared task-shortcut handlers (selection nav branches on shift) ──

function arrowKeyHandler({ e }: ShortcutCtx) {
  const rows = Array.from(document.querySelectorAll('[data-todo-id]'))
  const todoIds = rows.map(el => Number(el.getAttribute('data-todo-id')))
  if (todoIds.length === 0) return

  const ids = useUIStore.getState().selectedTodoIds
  if (ids.size > 0) {
    e.preventDefault()
    const { selectionFocusId, selectionAnchorId } = useUIStore.getState()
    const currentId = (e.shiftKey ? selectionFocusId : selectionAnchorId) ?? Array.from(ids)[0]
    if (currentId == null) return
    const currentIdx = todoIds.indexOf(currentId)
    if (currentIdx === -1) return
    const nextIdx = e.key === 'ArrowUp' ? currentIdx - 1 : currentIdx + 1
    if (nextIdx < 0 || nextIdx >= todoIds.length) return
    const nextId = todoIds[nextIdx]
    if (nextId == null) return
    if (e.shiftKey) {
      useUIStore.getState().rangeSelectTodo(nextId, todoIds)
    } else {
      useUIStore.getState().selectOneTodo(nextId)
    }
    rows[nextIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    return
  }

  e.preventDefault()
  const targetId = e.key === 'ArrowDown' ? todoIds[0] : todoIds[todoIds.length - 1]
  if (targetId == null) return
  useUIStore.getState().selectOneTodo(targetId)
  const targetIdx = e.key === 'ArrowDown' ? 0 : rows.length - 1
  rows[targetIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function homeEndHandler({ e }: ShortcutCtx) {
  const rows = Array.from(document.querySelectorAll('[data-todo-id]'))
  if (rows.length === 0) return
  e.preventDefault()
  const todoIds = rows.map(el => Number(el.getAttribute('data-todo-id')))
  const targetId = e.key === 'Home' ? todoIds[0] : todoIds[todoIds.length - 1]
  if (targetId == null) return
  const ids = useUIStore.getState().selectedTodoIds
  if (e.shiftKey && ids.size > 0) {
    useUIStore.getState().rangeSelectTodo(targetId, todoIds)
  } else {
    useUIStore.getState().selectOneTodo(targetId)
  }
  const targetEl = e.key === 'Home' ? rows[0] : rows[rows.length - 1]
  targetEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

// ── Bindings (table-driven, ordering-independent within section) ──

export const SINGLE_BINDINGS: SingleBinding[] = [
  // ── General — fire even while a text input has focus ──
  {
    chord: { key: 'Space', useCode: true, mod: true },
    allowInInput: true,
    modalRow: { category: 'general', label: 'Mod-Space', description: 'Quick Add task' },
    handler: ({ e }) => {
      e.preventDefault()
      useUIStore.getState().openQuickAdd()
    },
  },
  {
    chord: { key: 'k', mod: true },
    allowInInput: true,
    modalRow: { category: 'general', label: 'Mod-K', description: 'Command Palette' },
    handler: ({ e, callbacks }) => {
      e.preventDefault()
      callbacks.openPalette()
    },
  },
  {
    chord: { key: 'escape' },
    allowInInput: true,
    modalRow: { category: 'general', label: 'Esc', description: 'Close overlay / Clear selection' },
    handler: ({ callbacks }) => {
      const { editPopupMode, clipboardTodoIds } = useUIStore.getState()
      if (!editPopupMode) {
        useUIStore.getState().clearSelection()
      }
      if (clipboardTodoIds.length > 0) {
        useUIStore.getState().clearClipboard()
      }
      callbacks.closePalette()
    },
  },
  {
    chord: { key: '0', mod: true },
    allowInInput: true,
    handler: ({ e, callbacks }) => {
      if (!callbacks.fitView) return
      e.preventDefault()
      callbacks.fitView()
    },
  },
  {
    chord: { key: 'f', mod: true },
    allowInInput: true,
    handler: ({ e }) => {
      const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement | null
      if (!searchInput) return
      e.preventDefault()
      searchInput.focus()
      searchInput.select()
    },
  },

  // ── Undo / Redo / Cut / Paste / Select All — outside inputs only ──
  {
    chord: { key: 'z', mod: true, shift: false },
    modalRow: { category: 'general', label: 'Mod-Z', description: 'Undo' },
    handler: ({ e }) => {
      e.preventDefault()
      useUndoStore.getState().undo()
    },
  },
  {
    // Hidden alt redo binding — Mod-Y owns the modal row.
    chord: { key: 'z', mod: true, shift: true },
    handler: ({ e }) => {
      e.preventDefault()
      useUndoStore.getState().redo()
    },
  },
  {
    chord: { key: 'y', mod: true },
    modalRow: { category: 'general', label: 'Mod-Y', description: 'Redo' },
    handler: ({ e }) => {
      e.preventDefault()
      useUndoStore.getState().redo()
    },
  },
  {
    chord: { key: 'x', mod: true },
    handler: ({ e }) => {
      const ids = useUIStore.getState().selectedTodoIds
      if (ids.size === 0) return
      e.preventDefault()
      const { todos } = useTodoStore.getState()
      const first = todos.find(t => ids.has(t.id))
      useUIStore.getState().cutTasks(Array.from(ids), first?.projectId ?? null)
    },
  },
  {
    chord: { key: 'v', mod: true },
    handler: async ({ e }) => {
      const { clipboardTodoIds, focusedTodoId } = useUIStore.getState()
      if (clipboardTodoIds.length === 0) return
      e.preventDefault()
      const { todos } = useTodoStore.getState()
      const focusedTodo = focusedTodoId != null ? todos.find(t => t.id === focusedTodoId) : null
      if (focusedTodo && focusedTodo.projectId != null) {
        const projectTodos = todos
          .filter(t => t.projectId === focusedTodo.projectId)
          .sort(bySortOrder)
        const focusedIdx = projectTodos.findIndex(t => t.id === focusedTodo.id)
        const beforeTodo = focusedIdx < projectTodos.length - 1 ? projectTodos[focusedIdx + 1] : null
        await pasteTasksAt({
          projectId: focusedTodo.projectId,
          beforeTodoId: beforeTodo?.id ?? null,
        })
      } else {
        const sourceProjectId = useUIStore.getState().clipboardSourceProjectId
        if (sourceProjectId == null) return
        await pasteTasksAt({ projectId: sourceProjectId, beforeTodoId: null })
      }
    },
  },
  {
    chord: { key: 'a', mod: true },
    modalRow: { category: 'general', label: 'Mod-A', description: 'Select all visible tasks' },
    handler: ({ e }) => {
      const rows = Array.from(document.querySelectorAll('[data-todo-id]'))
      if (rows.length === 0) return
      e.preventDefault()
      const todoIds = rows.map(el => Number(el.getAttribute('data-todo-id')))
      useUIStore.getState().selectAll(todoIds)
    },
  },
  {
    // Shift+/ on most layouts; ignore shift state for layouts where ? sits elsewhere.
    chord: { key: '?', shiftAny: true },
    modalRow: { category: 'general', label: '?', description: 'Show this help' },
    handler: ({ e, callbacks }) => {
      if (!callbacks.openShortcutsModal) return
      e.preventDefault()
      callbacks.openShortcutsModal()
    },
  },

  // ── Navigation — outside inputs only ──
  {
    chord: { key: '/' },
    handler: ({ e }) => {
      const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement | null
      if (!searchInput) return
      e.preventDefault()
      searchInput.focus()
      searchInput.select()
    },
  },
  {
    chord: { key: 'f' },
    modalRow: { category: 'navigation', label: 'F', description: 'Focus filters' },
    handler: ({ e }) => {
      const filterRow = document.querySelector('[data-filter-row]')
      const firstBtn = filterRow?.querySelector('button') as HTMLElement | null
      if (!firstBtn) return
      e.preventDefault()
      firstBtn.focus()
    },
  },
  {
    chord: { key: 'n' },
    handler: ({ e, callbacks }) => {
      if (!callbacks.createFloatingNote) return
      e.preventDefault()
      callbacks.createFloatingNote()
    },
  },
  {
    chord: { key: 'p' },
    handler: ({ e, callbacks }) => {
      if (!callbacks.toggleProjectNavigator) return
      e.preventDefault()
      callbacks.toggleProjectNavigator()
    },
  },

  // ── Selection navigation — branches on shift inside the handler ──
  {
    chord: { key: 'arrowup', shiftAny: true },
    blockedByEditPopup: true,
    modalRow: { category: 'navigation', label: 'Up / Down', description: 'Select previous / next task' },
    handler: arrowKeyHandler,
  },
  {
    chord: { key: 'arrowdown', shiftAny: true },
    blockedByEditPopup: true,
    handler: arrowKeyHandler,
  },
  {
    chord: { key: 'home', shiftAny: true },
    blockedByEditPopup: true,
    modalRow: { category: 'navigation', label: 'Home / End', description: 'Select first / last task' },
    handler: homeEndHandler,
  },
  {
    chord: { key: 'end', shiftAny: true },
    blockedByEditPopup: true,
    handler: homeEndHandler,
  },

  // ── Task editing — outside inputs, blocked while edit popup is open ──
  {
    chord: { key: 'enter' },
    blockedByEditPopup: true,
    modalRow: { category: 'task', label: 'Enter', description: 'Edit selected task' },
    handler: ({ e }) => {
      const ids = useUIStore.getState().selectedTodoIds
      if (ids.size !== 1) return
      const todoId = Array.from(ids)[0]
      if (todoId == null) return
      e.preventDefault()
      useUIStore.getState().openEditPopup(todoId)
    },
  },
  {
    chord: { key: ' ' },
    blockedByEditPopup: true,
    modalRow: { category: 'task', label: 'Space', description: 'Toggle complete' },
    handler: ({ e }) => {
      const ids = useUIStore.getState().selectedTodoIds
      if (ids.size === 0) return
      e.preventDefault()
      const { todos } = useTodoStore.getState()
      const selectedTodos = todos.filter(t => ids.has(t.id))
      const allCompleted = selectedTodos.every(t => t.isCompleted)
      const action = allCompleted ? 'uncomplete' : 'complete'
      if (ids.size > 1) {
        useUIStore.getState().showBulkConfirmation(action, Array.from(ids))
      } else {
        const firstSelected = selectedTodos[0]
        if (firstSelected) {
          useTodoStore.getState().toggleComplete(firstSelected.id)
        }
      }
    },
  },
  {
    chord: { key: 'delete' },
    blockedByEditPopup: true,
    modalRow: { category: 'task', label: 'Delete', description: 'Delete selected task(s)' },
    handler: ({ e }) => {
      const ids = useUIStore.getState().selectedTodoIds
      if (ids.size === 0) return
      e.preventDefault()
      useUIStore.getState().showBulkConfirmation('delete', Array.from(ids))
    },
  },
  {
    chord: { key: 'insert' },
    blockedByEditPopup: true,
    modalRow: { category: 'task', label: 'Insert', description: 'Create task below selected' },
    handler: ({ e }) => {
      const ids = useUIStore.getState().selectedTodoIds
      if (ids.size !== 1) return
      const todoId = Array.from(ids)[0]
      if (todoId == null) return
      e.preventDefault()
      useUIStore.getState().clearSelection()
      useUIStore.getState().triggerInlineCreate(todoId)
    },
  },
]

export const SEQUENCE_BINDINGS: SequenceBinding[] = [
  {
    prefix: 'g', key: 'c',
    modalRow: { category: 'navigation', label: 'G then C', description: 'Go to Canvas' },
    handler: ({ callbacks }) => callbacks.navigate('/'),
  },
  {
    prefix: 'g', key: 'l',
    modalRow: { category: 'navigation', label: 'G then L', description: 'Go to List' },
    handler: ({ callbacks }) => callbacks.navigate('/list'),
  },
  {
    prefix: 'g', key: 'a',
    modalRow: { category: 'navigation', label: 'G then A', description: 'Go to Calendar' },
    handler: ({ callbacks }) => callbacks.navigate('/calendar'),
  },
  {
    prefix: 'g', key: 's',
    modalRow: { category: 'navigation', label: 'G then S', description: 'Go to Settings' },
    handler: ({ callbacks }) => callbacks.navigate('/settings'),
  },
]

/**
 * Modal-only rows that don't 1:1 map to a single binding:
 *  - "Shift+Up / Down" — covered by the `shiftAny` branch of the arrow handler.
 *  - Notes shortcuts — owned by CodeMirror in the notes editor, not this hook.
 */
export const MODAL_VIRTUAL_ROWS: ModalRow[] = [
  { category: 'navigation', label: 'Shift+Up / Down', description: 'Extend selection' },
  { category: 'notes', label: 'Alt-T', description: 'Convert current line to task' },
  { category: 'notes', label: 'Mod-B', description: 'Bold' },
  { category: 'notes', label: 'Mod-I', description: 'Italic' },
]

/** First keys that begin a sequence chord (set after a single keystroke). */
export const SEQUENCE_PREFIXES: ReadonlySet<string> = new Set(
  SEQUENCE_BINDINGS.map(b => b.prefix),
)

export interface ShortcutDocSection {
  category: ShortcutCategory
  label: string
  rows: ModalRow[]
}

/**
 * Group all visible rows by category in the order declared by SHORTCUT_CATEGORIES.
 * Single bindings without a modalRow are dispatch-only (e.g., Mod-X cut, '/' focus).
 */
export function getShortcutDocSections(): ShortcutDocSection[] {
  const rows: ModalRow[] = [
    ...SINGLE_BINDINGS.flatMap(b => (b.modalRow ? [b.modalRow] : [])),
    ...SEQUENCE_BINDINGS.map(b => b.modalRow),
    ...MODAL_VIRTUAL_ROWS,
  ]
  return SHORTCUT_CATEGORIES.map(c => ({
    category: c.id,
    label: c.label,
    rows: rows.filter(r => r.category === c.id),
  })).filter(s => s.rows.length > 0)
}
