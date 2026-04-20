import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { RailSide } from '../../../models/canvas-rails'
import { SLOT_MIN_PX } from '../../../models/canvas-rails'
import { useCanvasRailsStore } from '../../../stores/canvas-rails-store'
import styles from './SlotDivider.module.css'

interface SlotDividerProps {
  side: RailSide
  aboveSlotId: string
  belowSlotId: string
}

interface DragState {
  pointerId: number
  startCoord: number
  startAbove: number
  startBelow: number
  // Pixel size snapshot for every slot in the rail so non-adjacent slots
  // keep their measured height/width after the batch update.
  sizes: Record<string, number>
}

/**
 * Thin handle between two sibling slots that lets the user drag to rebalance
 * their relative sizes. On pointer-down we measure every slot in the rail;
 * on move we write pixel-valued flex weights for all of them via
 * `setSlotFlexBatch`, so only the adjacent pair grows/shrinks.
 */
export function SlotDivider({ side, aboveSlotId, belowSlotId }: SlotDividerProps) {
  const axis: 'x' | 'y' = side === 'left' || side === 'right' ? 'y' : 'x'
  const setSlotFlexBatch = useCanvasRailsStore((s) => s.setSlotFlexBatch)
  const dragRef = useRef<DragState | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const pendingRef = useRef<Record<string, number> | null>(null)
  const scheduledRef = useRef(false)

  const flushPending = useCallback(() => {
    scheduledRef.current = false
    rafIdRef.current = null
    const latest = pendingRef.current
    pendingRef.current = null
    if (latest) setSlotFlexBatch(side, latest)
  }, [setSlotFlexBatch, side])

  const schedule = useCallback((next: Record<string, number>) => {
    pendingRef.current = next
    if (scheduledRef.current) return
    scheduledRef.current = true
    rafIdRef.current = requestAnimationFrame(flushPending)
  }, [flushPending])

  useEffect(() => () => {
    if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
  }, [])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const root = e.currentTarget.closest('[data-rail-side]')
    if (!root) return
    const slotEls = root.querySelectorAll<HTMLElement>('[data-slot-id]')
    const sizes: Record<string, number> = {}
    for (const el of Array.from(slotEls)) {
      const id = el.dataset.slotId
      if (!id) continue
      const rect = el.getBoundingClientRect()
      sizes[id] = axis === 'y' ? rect.height : rect.width
    }
    const startAbove = sizes[aboveSlotId]
    const startBelow = sizes[belowSlotId]
    if (startAbove == null || startBelow == null) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startCoord: axis === 'y' ? e.clientY : e.clientX,
      startAbove,
      startBelow,
      sizes,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const pair = drag.startAbove + drag.startBelow
    const minA = Math.min(SLOT_MIN_PX, pair / 2)
    const minB = Math.min(SLOT_MIN_PX, pair / 2)
    const delta = (axis === 'y' ? e.clientY : e.clientX) - drag.startCoord
    const rawA = drag.startAbove + delta
    const clampedA = Math.max(minA, Math.min(pair - minB, rawA))
    const newBelow = pair - clampedA
    const flexBySlotId: Record<string, number> = { ...drag.sizes }
    flexBySlotId[aboveSlotId] = clampedA
    flexBySlotId[belowSlotId] = newBelow
    schedule(flexBySlotId)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (scheduledRef.current && rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current)
      flushPending()
    }
  }

  return (
    <div
      className={`${styles.divider} ${axis === 'y' ? styles.horizontal : styles.vertical}`}
      role="separator"
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label="Resize slot"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
