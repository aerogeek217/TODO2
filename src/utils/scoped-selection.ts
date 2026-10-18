/**
 * Selection inside one list widget ("scope"). A task can show more than once
 * in a widget (a task with two people appears in both people's groups), so
 * the widget's rows are addressed by occurrence key, not task id: the anchor
 * and the keyboard cursor sit on one occurrence; the selection itself is a
 * set of task ids (selecting one occurrence selects the task everywhere).
 */

/** One rendered row of a scope, in display order. */
export interface ScopedRow {
  /** Unique within the scope (e.g. `<section key>|<todo id>`). */
  key: string
  todoId: number
}

/** The scoped part of the selection state. */
export interface ScopedSelectionState {
  scope: string | null
  ids: ReadonlySet<number>
  anchorKey: string | null
}

export interface ScopedSelection {
  ids: Set<number>
  anchorKey: string
  cursorKey: string
  /** The task of the cursor's row. */
  cursorTodoId: number
}

export type ScopedSelectMode = 'one' | 'toggle' | 'range'

/** The occurrence key of a row in a widget. */
export function rowKey(sectionKey: string, todoId: number): string {
  return `${sectionKey}|${todoId}`
}

/**
 * The selection after clicking (or arrowing to) row `key` of `scope`:
 * - `one` — just that task.
 * - `toggle` — adds / removes that task (starts over in another scope).
 * - `range` — every task between the anchor occurrence and `key`, in display
 *   order (starts over when the anchor isn't in this scope's rows).
 *
 * Returns `null` when `key` isn't one of `rows`.
 */
export function nextScopedSelection(
  current: ScopedSelectionState,
  scope: string,
  rows: readonly ScopedRow[],
  key: string,
  mode: ScopedSelectMode,
): ScopedSelection | null {
  const target = rows.find((r) => r.key === key)
  if (!target) return null
  const sameScope = current.scope === scope
  if (mode === 'toggle' && sameScope) {
    const ids = new Set(current.ids)
    if (ids.has(target.todoId)) ids.delete(target.todoId)
    else ids.add(target.todoId)
    return { ids, anchorKey: key, cursorKey: key, cursorTodoId: target.todoId }
  }
  if (mode === 'range' && sameScope && current.anchorKey != null) {
    const from = rows.findIndex((r) => r.key === current.anchorKey)
    const to = rows.findIndex((r) => r.key === key)
    if (from !== -1) {
      const [lo, hi] = from <= to ? [from, to] : [to, from]
      const ids = new Set(rows.slice(lo, hi + 1).map((r) => r.todoId))
      return { ids, anchorKey: current.anchorKey, cursorKey: key, cursorTodoId: target.todoId }
    }
  }
  return { ids: new Set([target.todoId]), anchorKey: key, cursorKey: key, cursorTodoId: target.todoId }
}

/** The rows of a rendered scope, read from the DOM (`data-row-key` / `data-row-todo`). */
export function readScopeRows(scopeEl: ParentNode): ScopedRow[] {
  return Array.from(scopeEl.querySelectorAll<HTMLElement>('[data-row-key]')).map((el) => ({
    key: el.dataset.rowKey ?? '',
    todoId: Number(el.dataset.rowTodo),
  }))
}

/** The rendered element of a selection scope, if any. */
export function findScopeElement(scope: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-selection-scope]')) {
    if (el.dataset.selectionScope === scope) return el
  }
  return null
}
