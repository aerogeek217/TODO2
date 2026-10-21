import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { evenPair, pairPercent, resizePair } from '../../utils/workspace-resize'
import { useLatestRef } from '../../hooks/use-latest-ref'
import styles from './WorkspaceDivider.module.css'
import { shortcutScope } from '../../utils/dom-contract'

/** Keyboard step for a focused divider (px). */
const KEY_STEP_PX = 16
/** How far past a cell's minimum height the pointer must go to collapse it (px). */
const COLLAPSE_SLACK_PX = 24

interface WorkspaceDividerProps {
  /** `columns`: between two columns (drags left/right); `cells`: between two cells of a column. */
  between: 'columns' | 'cells'
  aId: string
  bId: string
  weightA: number
  weightB: number
  /** Smallest size (px) of either neighbour. */
  min: number
  /** New weights; `live` while dragging (each frame), then `onResizeEnd` once at the end. */
  onResize: (weightById: Record<string, number>, opts?: { live?: boolean }) => void
  /** The drag ended (kept the result: the frames weren't). */
  onResizeEnd?: () => void
  /** Cells only: dragging past a cell's minimum collapses it to its header. */
  onCollapse?: (id: string) => void
  label: string
}

interface DragState {
  pointerId: number
  start: number
  sizeA: number
  sizeB: number
  weightA: number
  weightB: number
}

function measure(between: 'columns' | 'cells', id: string): number | null {
  const attr = between === 'columns' ? 'data-ws-column' : 'data-ws-cell'
  const el = document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(id)}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return between === 'columns' ? r.width : r.height
}

/**
 * The gutter between two columns or two cells, as a resize handle: drag to
 * move it (rAF-throttled; only the two neighbours change; the frames are
 * `live` edits, kept in the browser once at the end), double-click to
 * even them out, ←/→ (↑/↓) to move it 16px. Neither neighbour goes below
 * `min`; dragging a cell well past its minimum collapses it instead.
 */
export function WorkspaceDivider({ between, aId, bId, weightA, weightB, min, onResize, onResizeEnd, onCollapse, label }: WorkspaceDividerProps) {
  const axisX = between === 'columns'
  const dragRef = useRef<DragState | null>(null)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<Record<string, number> | null>(null)
  const [dragging, setDragging] = useState(false)

  const flush = useCallback(() => {
    rafRef.current = null
    const next = pendingRef.current
    pendingRef.current = null
    if (next) onResize(next, { live: true })
  }, [onResize])

  const schedule = useCallback((next: Record<string, number>) => {
    pendingRef.current = next
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush)
  }, [flush])

  // Gone mid-drag: what the frames applied is kept all the same.
  const onResizeEndRef = useLatestRef(onResizeEnd)
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    if (dragRef.current) onResizeEndRef.current?.()
  }, [onResizeEndRef])

  const endDrag = (el: HTMLElement, pointerId: number) => {
    dragRef.current = null
    setDragging(false)
    if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId)
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      flush()
    }
    onResizeEnd?.()
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const sizeA = measure(between, aId)
    const sizeB = measure(between, bId)
    if (sizeA == null || sizeB == null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, start: axisX ? e.clientX : e.clientY, sizeA, sizeB, weightA, weightB }
    setDragging(true)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const delta = (axisX ? e.clientX : e.clientY) - drag.start
    const r = resizePair({ ...drag, delta, min })
    if (onCollapse) {
      const collapseId = r.rawA < min - COLLAPSE_SLACK_PX ? aId : r.rawB < min - COLLAPSE_SLACK_PX ? bId : null
      if (collapseId) {
        pendingRef.current = null
        endDrag(e.currentTarget, e.pointerId)
        onResize({ [aId]: drag.weightA, [bId]: drag.weightB })
        onCollapse(collapseId)
        return
      }
    }
    schedule({ [aId]: r.weightA, [bId]: r.weightB })
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    endDrag(e.currentTarget, e.pointerId)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = axisX ? 'ArrowRight' : 'ArrowDown'
    const shrink = axisX ? 'ArrowLeft' : 'ArrowUp'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    const sizeA = measure(between, aId)
    const sizeB = measure(between, bId)
    if (sizeA == null || sizeB == null) return
    const r = resizePair({ sizeA, sizeB, weightA, weightB, delta: e.key === grow ? KEY_STEP_PX : -KEY_STEP_PX, min })
    onResize({ [aId]: r.weightA, [bId]: r.weightB })
  }

  const onDoubleClick = () => {
    const even = evenPair(weightA, weightB)
    onResize({ [aId]: even.weightA, [bId]: even.weightB })
  }

  return (
    <div
      className={`${styles.divider} ${axisX ? styles.betweenColumns : styles.betweenCells} ${dragging ? styles.dragging : ''}`}
      role="separator"
      aria-orientation={axisX ? 'vertical' : 'horizontal'}
      aria-valuenow={pairPercent(weightA, weightB)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      tabIndex={0}
      data-ws-divider={`${aId}|${bId}`}
      // Its arrow keys move it; none of the app shortcuts (↑ / ↓ select tasks).
      {...shortcutScope('none')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    />
  )
}
