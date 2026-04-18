import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { Rail, RailSide } from '../../../models/canvas-rails'
import { encodeRailsDropId, RAILS_DRAG_TYPE } from './rail-dnd'
import styles from './RailContainer.module.css'

interface RailContainerProps {
  side: RailSide
  rail: Rail
  children: ReactNode
  railsDragging?: boolean
}

function EdgeDrop({ side, edge, orientation }: { side: RailSide; edge: 'head' | 'tail'; orientation: 'vertical' | 'horizontal' }) {
  const id = encodeRailsDropId({ kind: 'edge', side, edge })
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: RAILS_DRAG_TYPE } })
  const axisClass = orientation === 'vertical' ? styles.edgeVertical : styles.edgeHorizontal
  const edgeClass = edge === 'head' ? styles.edgeHead : styles.edgeTail
  return (
    <div
      ref={setNodeRef}
      className={`${styles.edge} ${axisClass} ${edgeClass} ${isOver ? styles.edgeOver : ''}`}
      aria-hidden="true"
    />
  )
}

export function RailContainer({ side, rail, children, railsDragging = false }: RailContainerProps) {
  const orientClass = rail.orientation === 'vertical' ? styles.vertical : styles.horizontal
  return (
    <aside
      className={`${styles.rail} ${orientClass} ${styles[side]}`}
      data-rail-side={side}
      aria-label={`Canvas ${side} rail`}
    >
      {railsDragging && <EdgeDrop side={side} edge="head" orientation={rail.orientation} />}
      {children}
      {railsDragging && <EdgeDrop side={side} edge="tail" orientation={rail.orientation} />}
    </aside>
  )
}
