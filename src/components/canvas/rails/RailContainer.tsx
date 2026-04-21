import { useCallback, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Rail, RailSide } from '../../../models/canvas-rails'
import { RAIL_SIZE_MAX, RAIL_SIZE_MIN, clampRailSize } from '../../../models/canvas-rails'
import styles from './RailContainer.module.css'

interface RailContainerProps {
  side: RailSide
  rail: Rail
  size: number
  onResize: (px: number) => void
  children: ReactNode
}

interface ResizeHandleProps {
  side: RailSide
  size: number
  onResize: (px: number) => void
}

function ResizeHandle({ side, size, onResize }: ResizeHandleProps) {
  const axis = side === 'left' || side === 'right' ? 'x' : 'y'
  const dragRef = useRef<{ startCoord: number; startSize: number; pointerId: number } | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const pendingRef = useRef<number | null>(null)
  const scheduledRef = useRef(false)

  const schedule = useCallback((px: number) => {
    pendingRef.current = px
    if (scheduledRef.current) return
    scheduledRef.current = true
    rafIdRef.current = requestAnimationFrame(() => {
      scheduledRef.current = false
      rafIdRef.current = null
      const latest = pendingRef.current
      pendingRef.current = null
      if (latest != null) onResize(latest)
    })
  }, [onResize])

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    // jsdom lacks pointer capture; guard so tests don't blow up.
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = {
      startCoord: axis === 'x' ? e.clientX : e.clientY,
      startSize: size,
      pointerId: e.pointerId,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const delta = (axis === 'x' ? e.clientX : e.clientY) - drag.startCoord
    // Canvas-facing edge direction: left/top rails grow with +delta; right/bottom rails grow with −delta.
    const sign = side === 'left' || side === 'top' ? 1 : -1
    schedule(clampRailSize(drag.startSize + sign * delta))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (pendingRef.current != null) {
      const latest = pendingRef.current
      pendingRef.current = null
      onResize(latest)
    }
  }

  const positionClass = (() => {
    switch (side) {
      case 'left': return styles.resizeRight
      case 'right': return styles.resizeLeft
      case 'top': return styles.resizeBottom
      case 'bottom': return styles.resizeTop
    }
  })()

  return (
    <div
      className={`${styles.resize} ${positionClass}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={`Resize ${side} rail`}
      aria-valuemin={RAIL_SIZE_MIN}
      aria-valuemax={RAIL_SIZE_MAX}
      aria-valuenow={size}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

export function RailContainer({ side, rail, size, onResize, children }: RailContainerProps) {
  const orientClass = rail.orientation === 'vertical' ? styles.vertical : styles.horizontal
  const style: CSSProperties = rail.orientation === 'vertical' ? { width: size } : { height: size }
  return (
    <aside
      className={`${styles.rail} ${orientClass} ${styles[side]}`}
      style={style}
      data-rail-side={side}
      aria-label={`Canvas ${side} rail`}
    >
      {children}
      <ResizeHandle side={side} size={size} onResize={onResize} />
    </aside>
  )
}
