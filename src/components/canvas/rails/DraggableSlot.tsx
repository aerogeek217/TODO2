import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { RailSide } from '../../../models/canvas-rails'
import { Slot } from './Slot'
import { encodeRailsDropId, RAILS_DRAG_TYPE, type RailsDragData } from './rail-dnd'
import styles from './DraggableSlot.module.css'

interface DraggableSlotProps {
  slotId: string
  fromSide: RailSide
  header: ReactElement
  children: ReactNode
}

export function DraggableSlot({ slotId, fromSide, header, children }: DraggableSlotProps) {
  const dragId = `rails-slot-drag:${slotId}`
  const dropId = encodeRailsDropId({ kind: 'slot', slotId })
  const dragData: RailsDragData = { type: RAILS_DRAG_TYPE, slotId, fromSide }

  const draggable = useDraggable({ id: dragId, data: dragData })
  const droppable = useDroppable({ id: dropId, data: { type: RAILS_DRAG_TYPE, slotId } })

  const headerWithHandle = isValidElement(header)
    ? cloneElement(header as ReactElement<{ dragHandleProps?: unknown }>, {
        dragHandleProps: {
          ref: draggable.setActivatorNodeRef,
          ...draggable.listeners,
          ...draggable.attributes,
        },
      })
    : header

  const classes = [
    styles.wrap,
    draggable.isDragging ? styles.dragging : '',
    droppable.isOver ? styles.over : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={(el) => {
        draggable.setNodeRef(el)
        droppable.setNodeRef(el)
      }}
      className={classes}
      data-slot-id={slotId}
    >
      <Slot header={headerWithHandle}>{children}</Slot>
    </div>
  )
}
