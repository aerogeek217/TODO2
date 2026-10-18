import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { BAND_DEFAULT_HEIGHT, type BandEdge, type LayoutBand } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { BAND_MIN_PX, COLUMN_AREA_MIN_PX, resizeBand } from '../../utils/workspace-resize'
import styles from './WorkspaceDivider.module.css'

/** Keyboard step for a focused band divider (px). */
const KEY_STEP_PX = 16
/** How far past the band's minimum height the pointer must go to collapse it (px). */
const COLLAPSE_SLACK_PX = 24

interface DragState {
  pointerId: number
  startY: number
  /** The band's drawn height when the drag started. */
  startHeight: number
  /** Its stored height then (put back when the drag collapses it). */
  storedHeight: number
  max: number
}

/** The band's drawn height and the tallest it may get (the column area keeps its minimum). */
function measure(edge: BandEdge): { height: number; max: number } | null {
  const bandEl = document.querySelector<HTMLElement>(`[data-ws-band="${edge}"]`)
  const columnsEl = document.querySelector<HTMLElement>('[data-ws-columns]')
  if (!bandEl || !columnsEl) return null
  const height = bandEl.getBoundingClientRect().height
  const room = columnsEl.getBoundingClientRect().height - COLUMN_AREA_MIN_PX
  return { height, max: height + Math.max(0, room) }
}

/**
 * The gutter between a band and the column area (under the top band, above
 * the bottom band), as a resize handle for the band's height: drag to move
 * it (rAF-throttled; the columns take the rest), double-click for the
 * default height, ↑ / ↓ to move it 16px. The band stays at least
 * `BAND_MIN_PX`; dragging well past that collapses it instead. The height
 * is layout structure, so the layout becomes unsaved.
 */
export function BandDivider({ edge, band }: { edge: BandEdge; band: LayoutBand }) {
  const setBandHeight = useWorkspaceStore((s) => s.setBandHeight)
  const setCellCollapsed = useWorkspaceStore((s) => s.setCellCollapsed)
  const dragRef = useRef<DragState | null>(null)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const flush = useCallback(() => {
    rafRef.current = null
    const next = pendingRef.current
    pendingRef.current = null
    if (next != null) setBandHeight(edge, next)
  }, [setBandHeight, edge])

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
  }, [])

  const endDrag = (el: HTMLElement, pointerId: number) => {
    dragRef.current = null
    setDragging(false)
    if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId)
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      flush()
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const m = measure(edge)
    if (!m) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startHeight: m.height, storedHeight: band.height, max: m.max }
    setDragging(true)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const r = resizeBand({ edge, startHeight: drag.startHeight, delta: e.clientY - drag.startY, max: drag.max })
    if (r.raw < BAND_MIN_PX - COLLAPSE_SLACK_PX) {
      pendingRef.current = null
      endDrag(e.currentTarget, e.pointerId)
      setBandHeight(edge, drag.storedHeight)
      void setCellCollapsed(band.id, true)
      return
    }
    pendingRef.current = r.height
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    endDrag(e.currentTarget, e.pointerId)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const m = measure(edge)
    if (!m) return
    const delta = e.key === 'ArrowDown' ? KEY_STEP_PX : -KEY_STEP_PX
    setBandHeight(edge, resizeBand({ edge, startHeight: m.height, delta, max: m.max }).height)
  }

  return (
    <div
      className={`${styles.divider} ${styles.betweenCells} ${dragging ? styles.dragging : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-valuenow={Math.round(band.height)}
      aria-valuemin={BAND_MIN_PX}
      aria-label={`Resize ${edge} band`}
      tabIndex={0}
      data-ws-band-divider={edge}
      // Its arrow keys move it; none of the app shortcuts (↑ / ↓ select tasks).
      data-shortcut-scope="none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setBandHeight(edge, BAND_DEFAULT_HEIGHT)}
      onKeyDown={onKeyDown}
    />
  )
}
