import { useCallback, useState, type DragEvent } from 'react'
import { useTaskboardStore } from '../stores/taskboard-store'
import { computeTaskboardInsertIndex } from '../utils/taskboard-insert'

const DRAG_MIME = 'application/x-todo-drag'

function hasExternalTodo(types: readonly string[]): boolean {
  for (const t of types) if (t === DRAG_MIME) return true
  return false
}

function parseTodoId(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && parsed.kind === 'todo' && typeof parsed.todoId === 'number') {
      return parsed.todoId
    }
  } catch {
    // fallthrough to plain number parse
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

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
    if (!hasExternalTodo(e.dataTransfer.types)) return
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
    const todoId = parseTodoId(raw)
    if (todoId == null) { clear(); return }
    e.preventDefault()
    const idx = computeTaskboardInsertIndex(panelDroppableId, e.clientY)
    void useTaskboardStore.getState().addAt(todoId, idx)
    clear()
  }, [panelDroppableId, clear])

  return { externalInsertIndex, isExternalDragOver, onDragOver, onDragLeave, onDrop }
}
