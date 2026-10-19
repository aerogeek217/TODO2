import { useEffect, useRef, useState, type RefObject } from 'react'
import { useDndMonitor, type DragStartEvent } from '@dnd-kit/core'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import {
  contentY,
  listRowDropTarget,
  measureListGeometry,
  type ListGeometry,
  type ListRowDragSource,
  type ListRowDropTarget,
} from '../../../utils/list-row-drop'
import type { ListRowDragData } from './ListWidgetRow'

/** A row drag inside one list widget: the dragged row and where it would land. */
export interface ListRowDragState {
  source: ListRowDragSource
  target: ListRowDropTarget | null
  /** The pointer (viewport) when the landing spot last changed. */
  pointer?: { x: number; y: number }
}

interface UseListRowDragOptions {
  tabId: string
  /** The widget's scroll container (holds the `data-list-section` blocks). */
  scrollRef: RefObject<HTMLElement | null>
  /** Groups take rows from each other (people / status / tag groups). */
  canCross: boolean
  onDrop: (source: ListRowDragSource, target: ListRowDropTarget) => void
}

function isListRowData(v: unknown): v is ListRowDragData & { todo: { id: number } } {
  return v != null && typeof v === 'object' && typeof (v as ListRowDragData).listTabId === 'string'
}

/**
 * Tracks a drag of one of this widget's rows (the surrounding `DndContext`
 * does the dragging): measures the widget when the drag starts, follows the
 * pointer to the landing spot, and calls `onDrop` when the row is let go
 * over the widget. Drags from elsewhere, and drops outside the widget, are
 * left to the page (calendar days etc.).
 */
export function useListRowDrag({ tabId, scrollRef, canCross, onDrop }: UseListRowDragOptions): ListRowDragState | null {
  const [drag, setDragState] = useState<ListRowDragState | null>(null)
  const dragRef = useRef<ListRowDragState | null>(null)
  const geomRef = useRef<ListGeometry | null>(null)
  /** Removes the drag's `pointermove` listener; set while one of this widget's rows is dragged. */
  const stopFollowingRef = useRef<(() => void) | null>(null)
  const onDropRef = useLatestRef(onDrop)
  const canCrossRef = useLatestRef(canCross)

  const setDrag = (next: ListRowDragState | null) => {
    dragRef.current = next
    setDragState(next)
  }

  const endDrag = () => {
    stopFollowingRef.current?.()
    stopFollowingRef.current = null
    geomRef.current = null
    setDrag(null)
  }

  /** Follows the pointer to the landing spot, from the drag's first move on. */
  const followPointer = () => {
    const onMove = (e: PointerEvent) => {
      const current = dragRef.current
      const scrollEl = scrollRef.current
      const geom = geomRef.current
      if (!current || !scrollEl || !geom) return
      const r = scrollEl.getBoundingClientRect()
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      const target = inside ? listRowDropTarget(geom, contentY(scrollEl, e.clientY), current.source, canCrossRef.current) : null
      const prev = current.target
      if (prev === target || (prev && target && prev.sectionKey === target.sectionKey && prev.index === target.index && prev.cross === target.cross)) return
      setDrag({ ...current, target, pointer: { x: e.clientX, y: e.clientY } })
    }
    window.addEventListener('pointermove', onMove)
    stopFollowingRef.current = () => window.removeEventListener('pointermove', onMove)
  }

  useDndMonitor({
    onDragStart(event: DragStartEvent) {
      const data = event.active.data.current
      const scrollEl = scrollRef.current
      if (!isListRowData(data) || data.listTabId !== tabId || !scrollEl) return
      const geom = measureListGeometry(scrollEl)
      geomRef.current = geom
      const section = geom.sections.find((s) => s.key === data.sectionKey)
      const index = section ? section.rows.findIndex((r) => r.key === data.rowKey) : -1
      setDrag({
        source: { key: data.rowKey, todoId: data.todo.id, sectionKey: data.sectionKey, index: Math.max(0, index) },
        target: null,
      })
      // Attached here, not in an effect after the render: the pointer may
      // reach its landing spot and stop before an effect would run.
      stopFollowingRef.current?.()
      followPointer()
    },
    onDragEnd() {
      const current = dragRef.current
      if (!current) return
      endDrag()
      if (current.target) onDropRef.current(current.source, current.target)
    },
    onDragCancel() {
      if (!dragRef.current) return
      endDrag()
    },
  })

  // The widget unmounted mid-drag: stop following the pointer.
  useEffect(() => () => stopFollowingRef.current?.(), [])

  return drag
}
