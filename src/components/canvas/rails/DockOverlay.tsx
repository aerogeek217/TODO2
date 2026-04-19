import { useDroppable } from '@dnd-kit/core'
import type { RailSide } from '../../../models/canvas-rails'
import { encodeRailsDropId, RAILS_DRAG_TYPE } from './rail-dnd'
import styles from './DockOverlay.module.css'

interface DockOverlayProps {
  emptySides: RailSide[]
}

const SIDE_LABEL: Record<RailSide, string> = {
  left: 'left',
  right: 'right',
  top: 'top',
  bottom: 'bottom',
}

function EmptySideDrop({ side }: { side: RailSide }) {
  const id = encodeRailsDropId({ kind: 'empty-side', side })
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: RAILS_DRAG_TYPE } })
  const label = `Dock to ${SIDE_LABEL[side]} rail`
  return (
    <div
      ref={setNodeRef}
      className={`${styles.zone} ${styles[side]} ${isOver ? styles.over : ''}`}
      role="button"
      aria-label={label}
      data-drop-id={id}
    >
      <span className={styles.label}>Dock {side}</span>
    </div>
  )
}

export function DockOverlay({ emptySides }: DockOverlayProps) {
  if (emptySides.length === 0) return null
  return (
    <div className={styles.overlay} role="group" aria-label="Rail drop zones">
      {emptySides.map((side) => (
        <EmptySideDrop key={side} side={side} />
      ))}
    </div>
  )
}
