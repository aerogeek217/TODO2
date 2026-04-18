import { useDroppable } from '@dnd-kit/core'
import type { RailSide } from '../../../models/canvas-rails'
import { encodeRailsDropId, RAILS_DRAG_TYPE } from './rail-dnd'
import styles from './DockOverlay.module.css'

interface DockOverlayProps {
  emptySides: RailSide[]
}

function EmptySideDrop({ side }: { side: RailSide }) {
  const id = encodeRailsDropId({ kind: 'empty-side', side })
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: RAILS_DRAG_TYPE } })
  return (
    <div
      ref={setNodeRef}
      className={`${styles.zone} ${styles[side]} ${isOver ? styles.over : ''}`}
      aria-hidden="true"
    >
      <span className={styles.label}>Dock {side}</span>
    </div>
  )
}

export function DockOverlay({ emptySides }: DockOverlayProps) {
  if (emptySides.length === 0) return null
  return (
    <div className={styles.overlay} aria-hidden="true">
      {emptySides.map((side) => (
        <EmptySideDrop key={side} side={side} />
      ))}
    </div>
  )
}
