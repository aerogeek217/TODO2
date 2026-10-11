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
import {
  findScopeElement,
  nextScopedSelection,
  readScopeRows,
  type ScopedSelectMode,
} from '../utils/scoped-selection'
import { ROUTE_SETTINGS, ROUTE_WORKSPACE } from '../routes'

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
  openShortcutsModal?: () => void
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

/**
 * Moves the selection to row `index` of a list widget's rows (`one`, or
 * `range` from the anchor). Returns false when the scope isn't rendered.
 */
function selectScopeRow(scope: string, pick: (count: number, cursorIdx: number) => number | null, mode: ScopedSelectMode): boolean {
  const el = findScopeElement(scope)
  if (!el) return false
  const rows = readScopeRows(el)
  if (rows.length === 0) return true
  const ui = useUIStore.getState()
  const cursorIdx = ui.selectionScope === scope && ui.selectionCursorKey != null
    ? rows.findIndex((r) => r.key === ui.selectionCursorKey)
    : -1
  const idx = pick(rows.length, cursorIdx)
  const row = idx != null ? rows[idx] : undefined
  if (!row) return true
  const next = nextScopedSelection(
    { scope: ui.selectionScope, ids: ui.selectedTodoIds, anchorKey: ui.selectionAnchorKey },
    scope, rows, row.key, mode,
  )
  if (next) ui.setScopedSelection(scope, next)
  el.querySelectorAll<HTMLElement>('[data-row-key]')[idx as number]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  return true
}

/** The list widget a fresh keyboard selection starts in: the one holding `row`, if any. */
function scopeOf(row: Element | undefined): string | null {
  return row?.closest<HTMLElement>('[data-selection-scope]')?.dataset.selectionScope ?? null
}

function arrowKeyHandler({ e }: ShortcutCtx) {
  const up = e.key === 'ArrowUp'
  const scope = useUIStore.getState().selectionScope
  if (scope && useUIStore.getState().selectedTodoIds.size > 0) {
    const handled = selectScopeRow(
      scope,
      (count, cur) => {
        if (cur === -1) return up ? count - 1 : 0
        const next = up ? cur - 1 : cur + 1
        return next < 0 || next >= count ? null : next
      },
      e.shiftKey ? 'range' : 'one',
    )
    if (handled) {
      e.preventDefault()
      return
    }
  }

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
  const targetIdx = e.key === 'ArrowDown' ? 0 : rows.length - 1
  // A list widget's rows: start a selection in that widget.
  const startScope = scopeOf(rows[targetIdx])
  if (startScope && selectScopeRow(startScope, (count) => (up ? count - 1 : 0), 'one')) return
  const targetId = todoIds[targetIdx]
  if (targetId == null) return
  useUIStore.getState().selectOneTodo(targetId)
  rows[targetIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function homeEndHandler({ e }: ShortcutCtx) {
  const home = e.key === 'Home'
  const scope = useUIStore.getState().selectionScope
  if (scope && selectScopeRow(scope, (count) => (home ? 0 : count - 1), e.shiftKey ? 'range' : 'one')) {
    e.preventDefault()
    return
  }
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
      if (!useUIStore.getState().editPopupMode) {
        useUIStore.getState().clearSelection()
      }
      callbacks.closePalette()
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

  // ── Undo / Redo / Select All — outside inputs only ──
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
    chord: { key: 'a', mod: true },
    modalRow: { category: 'general', label: 'Mod-A', description: 'Select all visible tasks' },
    handler: ({ e }) => {
      // In a list widget with a selection: that widget's rows.
      const scope = useUIStore.getState().selectionScope
      const scopeEl = scope ? findScopeElement(scope) : null
      if (scope && scopeEl) {
        const rows = readScopeRows(scopeEl)
        const first = rows[0]
        const last = rows[rows.length - 1]
        if (!first || !last) return
        e.preventDefault()
        useUIStore.getState().setScopedSelection(scope, {
          ids: new Set(rows.map((r) => r.todoId)),
          anchorKey: first.key,
          cursorKey: last.key,
          cursorTodoId: last.todoId,
        })
        return
      }
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
]

export const SEQUENCE_BINDINGS: SequenceBinding[] = [
  {
    prefix: 'g', key: 'w',
    modalRow: { category: 'navigation', label: 'G then W', description: 'Go to Workspace' },
    handler: ({ callbacks }) => callbacks.navigate(ROUTE_WORKSPACE),
  },
  {
    prefix: 'g', key: 's',
    modalRow: { category: 'navigation', label: 'G then S', description: 'Go to Settings' },
    handler: ({ callbacks }) => callbacks.navigate(ROUTE_SETTINGS),
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
 * Single bindings without a modalRow are dispatch-only (e.g., Mod-F / '/' focus search).
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
