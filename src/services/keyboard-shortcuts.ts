/**
 * What each keyboard shortcut does, by binding id. The keys live in the
 * binding table (`models/keyboard-shortcut`, with the user's changes from
 * `utils/shortcut-bindings`); `hooks/use-keyboard-shortcuts` matches a key
 * press to a binding and runs its handler here, and the command palette runs
 * the same handlers for its commands that have a binding
 * (`runShortcutCommand`). The table is compile-checked against every id, so a
 * new binding needs its handler.
 */

import { shortcutSpec, type ShortcutId } from '../models/keyboard-shortcut'
import { useUIStore } from '../stores/ui-store'
import { scrollBehavior } from '../utils/motion'
import { useTodoStore } from '../stores/todo-store'
import { useUndoStore } from '../stores/undo-store'
import {
  findScopeElement,
  nextScopedSelection,
  readScopeRows,
  type ScopedSelectMode,
} from '../utils/scoped-selection'
import {
  attrSelector,
  FILTER_ROW_ATTR,
  readTodoIds,
  ROW_KEY_ATTR,
  SEARCH_INPUT_ATTR,
  SELECTION_SCOPE_ATTR,
} from '../utils/dom-contract'

export interface ShortcutCallbacks {
  openPalette: () => void
  closePalette: () => void
  openSettings: () => void
  openShortcutsModal?: () => void
}

/** What a handler reads of the key press: a `KeyboardEvent`, or `NO_KEY_PRESS` from the palette. */
export type ShortcutInput = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>

export interface ShortcutCtx {
  e: ShortcutInput
  callbacks: ShortcutCallbacks
}

export type ShortcutHandler = (ctx: ShortcutCtx) => void | Promise<void>

/** A palette command's run: no key, no Shift, nothing to prevent. */
const NO_KEY_PRESS: ShortcutInput = { key: '', shiftKey: false, preventDefault: () => {} }

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
  el.querySelectorAll<HTMLElement>(attrSelector(ROW_KEY_ATTR))[idx as number]?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  return true
}

/** The list widget a fresh keyboard selection starts in: the one holding `row`, if any. */
function scopeOf(row: Element | undefined): string | null {
  return row?.closest(attrSelector(SELECTION_SCOPE_ATTR))?.getAttribute(SELECTION_SCOPE_ATTR) ?? null
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

  const { rows, ids: todoIds } = readTodoIds()
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
    rows[nextIdx]?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
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
  rows[targetIdx]?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
}

function homeEndHandler({ e }: ShortcutCtx) {
  const home = e.key === 'Home'
  const scope = useUIStore.getState().selectionScope
  if (scope && selectScopeRow(scope, (count) => (home ? 0 : count - 1), e.shiftKey ? 'range' : 'one')) {
    e.preventDefault()
    return
  }
  const { rows, ids: todoIds } = readTodoIds()
  if (rows.length === 0) return
  e.preventDefault()
  const targetId = e.key === 'Home' ? todoIds[0] : todoIds[todoIds.length - 1]
  if (targetId == null) return
  const ids = useUIStore.getState().selectedTodoIds
  if (e.shiftKey && ids.size > 0) {
    useUIStore.getState().rangeSelectTodo(targetId, todoIds)
  } else {
    useUIStore.getState().selectOneTodo(targetId)
  }
  const targetEl = e.key === 'Home' ? rows[0] : rows[rows.length - 1]
  targetEl?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
}


function focusSearch({ e }: ShortcutCtx) {
  const searchInput = document.querySelector<HTMLInputElement>(attrSelector(SEARCH_INPUT_ATTR))
  if (!searchInput) return
  e.preventDefault()
  searchInput.focus()
  searchInput.select()
}

function redo({ e }: ShortcutCtx) {
  e.preventDefault()
  void useUndoStore.getState().redo()
}

/** Every binding's handler. */
export const SHORTCUT_HANDLERS: Readonly<Record<ShortcutId, ShortcutHandler>> = {
  'quick-add': ({ e }) => {
    e.preventDefault()
    useUIStore.getState().openQuickAdd()
  },
  'command-palette': ({ e, callbacks }) => {
    e.preventDefault()
    callbacks.openPalette()
  },
  'close-overlay': ({ callbacks }) => {
    if (!useUIStore.getState().editPopupMode) {
      useUIStore.getState().clearSelection()
    }
    callbacks.closePalette()
  },
  undo: ({ e }) => {
    e.preventDefault()
    void useUndoStore.getState().undo()
  },
  redo,
  'redo-alt': redo,
  'select-all': ({ e }) => {
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
    const { rows, ids: todoIds } = readTodoIds()
    if (rows.length === 0) return
    e.preventDefault()
    useUIStore.getState().selectAll(todoIds)
  },
  'show-shortcuts': ({ e, callbacks }) => {
    if (!callbacks.openShortcutsModal) return
    e.preventDefault()
    callbacks.openShortcutsModal()
  },
  'focus-search': focusSearch,
  'focus-search-alt': focusSearch,
  'focus-filters': ({ e }) => {
    const filterRow = document.querySelector(attrSelector(FILTER_ROW_ATTR))
    const firstBtn = filterRow?.querySelector<HTMLElement>('button')
    if (!firstBtn) return
    e.preventDefault()
    firstBtn.focus()
  },
  'open-settings': ({ callbacks }) => callbacks.openSettings(),
  'select-previous': arrowKeyHandler,
  'select-next': arrowKeyHandler,
  'select-first': homeEndHandler,
  'select-last': homeEndHandler,
  'edit-selected': ({ e }) => {
    const ids = useUIStore.getState().selectedTodoIds
    if (ids.size !== 1) return
    const todoId = Array.from(ids)[0]
    if (todoId == null) return
    e.preventDefault()
    useUIStore.getState().openEditPopup(todoId)
  },
  'toggle-complete': ({ e }) => {
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
        void useTodoStore.getState().toggleComplete(firstSelected.id)
      }
    }
  },
  'delete-selected': ({ e }) => {
    const ids = useUIStore.getState().selectedTodoIds
    if (ids.size === 0) return
    e.preventDefault()
    useUIStore.getState().showBulkConfirmation('delete', Array.from(ids))
  },
}

/** Runs a binding's handler; one that fails says so in the snackbar instead of rejecting unseen. */
export async function runShortcut(id: ShortcutId, ctx: ShortcutCtx): Promise<void> {
  try {
    await SHORTCUT_HANDLERS[id](ctx)
  } catch (err) {
    console.error(`[shortcuts] ${id} failed`, err)
    useUndoStore.getState().notify(`Couldn't run “${shortcutSpec(id).description}”.`)
  }
}

/** A palette command that has a binding: its handler, as the key press would run it. */
export function runShortcutCommand(id: ShortcutId, callbacks: ShortcutCallbacks): Promise<void> {
  return runShortcut(id, { e: NO_KEY_PRESS, callbacks })
}
