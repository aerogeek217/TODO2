import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { EmptySideClaim, RailSide } from '../../../models/canvas-rails'
import { encodeRailsDropId, RAILS_DRAG_TYPE } from '../../../utils/rail-dnd'
import { useUIStore } from '../../../stores/ui-store'
import styles from './DockOverlay.module.css'

interface DockOverlayProps {
  emptySides: RailSide[]
  /**
   * When true, render the overlay even if every side is occupied — during a
   * float-widget drag the user can drop into an existing rail (creating a new
   * slot) or onto a slot/tab-strip, so the overlay affordance stays useful
   * without any empty sides. Gate driven from `ui-store.floatDrag !== null`.
   */
  floatDragActive?: boolean
}

const SIDE_LABEL: Record<RailSide, string> = {
  left: 'left',
  right: 'right',
  top: 'top',
  bottom: 'bottom',
}

const CLAIM_LABEL: Record<RailSide, Record<EmptySideClaim, string>> = {
  top: { start: 'northwest', end: 'northeast' },
  bottom: { start: 'southwest', end: 'southeast' },
  left: { start: 'northwest', end: 'southwest' },
  right: { start: 'northeast', end: 'southeast' },
}

function stripPart(side: RailSide, claim?: EmptySideClaim): string {
  // Maps an empty-side strip sub-zone to one of 12 CSS classes:
  //   {side}_{start|center|end}
  // Each class positions the sub-zone absolutely at the frame edge with
  // width/height keyed off `--left-size`/`--right-size`/`--top-size`/
  // `--bottom-size`, so corner sub-zones collapse to 0 when the perpendicular
  // rail is absent (nothing to claim).
  return `${side}_${claim ?? 'center'}`
}

function SubZone({ side, claim }: { side: RailSide; claim?: EmptySideClaim }) {
  const id = encodeRailsDropId({ kind: 'empty-side', side, claim })
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: RAILS_DRAG_TYPE } })
  // React-Flow float drags don't fire dnd-kit `isOver`, so derive an
  // equivalent hover flag from pointer position while a float is in flight.
  const floatDragActive = useUIStore((s) => s.floatDrag !== null)
  const ref = useRef<HTMLDivElement | null>(null)
  const [pointerInside, setPointerInside] = useState(false)
  useEffect(() => {
    if (!floatDragActive || isOver) {
      setPointerInside(false)
      return
    }
    const onMove = (e: PointerEvent) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top && e.clientY <= rect.bottom
      setPointerInside(inside)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [floatDragActive, isOver])
  const hoverActive = isOver || pointerInside
  const label = claim
    ? `Dock to ${SIDE_LABEL[side]} rail, claim ${CLAIM_LABEL[side][claim]} corner`
    : `Dock to ${SIDE_LABEL[side]} rail`
  const classes = [styles.zone, styles[stripPart(side, claim)]]
  if (claim) classes.push(styles.corner)
  if (hoverActive) classes.push(styles.over)
  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        ref.current = el
      }}
      className={classes.join(' ')}
      role="button"
      aria-label={label}
      data-rails-drop-id={id}
    >
      {!claim && <span className={styles.label}>Dock {side}</span>}
    </div>
  )
}

export function DockOverlay({ emptySides, floatDragActive = false }: DockOverlayProps) {
  if (!floatDragActive && emptySides.length === 0) return null
  return (
    <div className={styles.overlay} role="group" aria-label="Rail drop zones">
      {emptySides.map((side) => (
        <div key={side} className={styles.strip}>
          <SubZone side={side} claim="start" />
          <SubZone side={side} />
          <SubZone side={side} claim="end" />
        </div>
      ))}
    </div>
  )
}
