import { useCallback, useState, type DragEvent } from 'react'
import { useTaskboardStore } from '../stores/taskboard-store'
import { computeTaskboardInsertIndex, computeTaskboardFullInsertIndex } from '../utils/taskboard-insert'
import { DRAG_MIME, hasTodoDragMime, parseTodoDragPayload } from '../utils/task-dnd'

/**
 * Native HTML5 drop target for "external" todo drags (e.g. calendar events)
 * into the (singleton) taskboard. Mirrors the contract of the existing
 * dnd-kit task-row → taskboard drop: compute insertion index via
 * `computeTaskboardInsertIndex` from pointer Y, then call
 * `useTaskboardStore.addAt`. `addAt` is a no-op when the todo is already on
 * the board, matching the dnd-kit path.
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
    setExternalInsertIndex(computeTaskboardInsertIndex(panelDroppableId, e.clientY))
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
    const idx = computeTaskboardFullInsertIndex(panelDroppableId, e.clientY, entries)
    void useTaskboardStore.getState().addAt(todoId, idx)
    clear()
  }, [panelDroppableId, clear])

  return { externalInsertIndex, isExternalDragOver, onDragOver, onDragLeave, onDrop }
}
