import { useCallback, useState, type DragEvent } from 'react'
import { useTaskboardStore } from '../stores/taskboard-store'
import { DRAG_MIME, hasTodoDragMime, parseTodoDragPayload } from '../utils/task-dnd'

/**
 * Compute the insertion index *within the rendered (visible) entries* for a
 * native-HTML5 drop onto a taskboard panel. Compares pointer Y against each
 * rendered entry's vertical midpoint. Returns `0..N` where `N` is the visible
 * row count (append).
 *
 * Inlined here (rather than shared from `utils/`) because this is the only
 * surviving DOM-scan caller after Phase 6 of the DnD unification — the dnd-
 * kit taskboard drops now read insertion index from the native sortable
 * data. Phase 7 retires native HTML5 drag for calendar rows entirely and
 * deletes this hook.
 */
function visibleIndexFromPointer(panelDroppableId: string, pointerY: number): number {
  const panel = document.querySelector<HTMLElement>(
    `[data-taskboard-panel-id="${panelDroppableId}"]`,
  )
  if (!panel) return 0
  const rows = panel.querySelectorAll<HTMLElement>('[data-tbp-entry]')
  if (rows.length === 0) return 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect()
    if (pointerY < r.top + r.height / 2) return i
  }
  return rows.length
}

/**
 * Full-array insertion index for a native drop. `useTaskboardStore.addAt`
 * operates on the board's full entries list, which may have hidden rows
 * above the drop — we map the visible row chosen by
 * {@link visibleIndexFromPointer} back to its slot in the full array via
 * `data-todo-id`.
 */
function fullIndexFromPointer(
  panelDroppableId: string,
  pointerY: number,
  fullEntries: readonly { todoId: number }[],
): number {
  const panel = document.querySelector<HTMLElement>(
    `[data-taskboard-panel-id="${panelDroppableId}"]`,
  )
  if (!panel) return fullEntries.length
  const rows = panel.querySelectorAll<HTMLElement>('[data-tbp-entry]')
  if (rows.length === 0) return fullEntries.length
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect()
    if (pointerY < r.top + r.height / 2) {
      const todoId = Number(rows[i].dataset.todoId)
      if (!Number.isFinite(todoId)) return fullEntries.length
      const idx = fullEntries.findIndex((e) => e.todoId === todoId)
      return idx === -1 ? fullEntries.length : idx
    }
  }
  return fullEntries.length
}

/**
 * Native HTML5 drop target for "external" todo drags (e.g. calendar events)
 * into the (singleton) taskboard. Mirrors the contract of the dnd-kit task-
 * row → taskboard drop: compute insertion index from pointer Y, then call
 * `useTaskboardStore.addAt`. `addAt` is a no-op when the todo is already on
 * the board.
 *
 * The hook returns state (`externalInsertIndex`, `isExternalDragOver`) so the
 * panel can render its normal insertion indicator and drop-target highlight.
 */
export function useExternalTaskboardDrop(panelDroppableId: string) {
  const [externalInsertIndex, setExternalInsertIndex] = useState<number | null>(null)
  const [isExternalDragOver, setIsExternalDragOver] = useState(false)

  const clear = useCallback(() => {
    setIsExternalDragOver(false)
    setExternalInsertIndex(null)
  }, [])

  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasTodoDragMime(e.dataTransfer.types)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsExternalDragOver(true)
    setExternalInsertIndex(visibleIndexFromPointer(panelDroppableId, e.clientY))
  }, [panelDroppableId])

  const onDragLeave = useCallback((e: DragEvent) => {
    // Ignore bubbled leave events when the pointer is still over a descendant.
    const related = e.relatedTarget as Node | null
    const current = e.currentTarget as Node
    if (related && current.contains(related)) return
    clear()
  }, [clear])

  const onDrop = useCallback((e: DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain')
    if (!raw) { clear(); return }
    const todoId = parseTodoDragPayload(raw)
    if (todoId == null) { clear(); return }
    e.preventDefault()
    const entries = useTaskboardStore.getState().getEntries()
    const idx = fullIndexFromPointer(panelDroppableId, e.clientY, entries)
    void useTaskboardStore.getState().addAt(todoId, idx)
    clear()
  }, [panelDroppableId, clear])

  return { externalInsertIndex, isExternalDragOver, onDragOver, onDragLeave, onDrop }
}
