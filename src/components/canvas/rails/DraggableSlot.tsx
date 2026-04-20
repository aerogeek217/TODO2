import { cloneElement, isValidElement, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { RailSide } from '../../../models/canvas-rails'
import { railOrientationForSide } from '../../../models/canvas-rails'
import { Slot } from './Slot'
import { encodeRailsDropId, pointerToSplitZone, RAILS_DRAG_TYPE, type RailsDragData, type SplitZone } from './rail-dnd'
import styles from './DraggableSlot.module.css'

interface DraggableSlotProps {
  slotId: string
  fromSide: RailSide
  header: ReactElement
  children: ReactNode
  flex?: number
}

export function DraggableSlot({ slotId, fromSide, header, children, flex }: DraggableSlotProps) {
  const dragId = `rails-slot-drag:${slotId}`
  const dropId = encodeRailsDropId({ kind: 'slot', slotId })
  const dragData: RailsDragData = { type: RAILS_DRAG_TYPE, slotId, fromSide }

  const draggable = useDraggable({ id: dragId, data: dragData })
  const droppable = useDroppable({ id: dropId, data: { type: RAILS_DRAG_TYPE, slotId } })
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [hoverZone, setHoverZone] = useState<SplitZone | null>(null)

  // When this slot is being hovered by an active drag (and it isn't the source
  // itself), track the pointer against its rect and surface which zone the
  // pointer is in so the user can predict the outcome (swap vs insert) before
  // releasing.
  useEffect(() => {
    if (!droppable.isOver || draggable.isDragging) {
      setHoverZone(null)
      return
    }
    const orientation = railOrientationForSide(fromSide)
    const onMove = (e: PointerEvent) => {
      const el = wrapRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const zone = pointerToSplitZone(
        { x: e.clientX, y: e.clientY },
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        orientation,
      )
      setHoverZone(zone)
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
    }
  }, [droppable.isOver, draggable.isDragging, fromSide])

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

  const style = flex != null && Number.isFinite(flex) && flex > 0
    ? ({ '--slot-flex': flex } as CSSProperties)
    : undefined

  return (
    <div
      ref={(el) => {
        draggable.setNodeRef(el)
        droppable.setNodeRef(el)
        wrapRef.current = el
      }}
      className={classes}
      data-slot-id={slotId}
      data-drop-id={dropId}
      style={style}
    >
      <Slot header={headerWithHandle}>{children}</Slot>
      {hoverZone && <ZoneIndicator zone={hoverZone} />}
    </div>
  )
}

function ZoneIndicator({ zone }: { zone: SplitZone }) {
  const meta = ZONE_META[zone]
  const testId = zone === 'center' ? 'swap-indicator' : 'insert-indicator'
  const className = `${styles.zoneIndicator} ${styles[meta.pos]}`
  return (
    <div className={className} aria-hidden="true" data-testid={testId} data-zone={zone}>
      <span className={styles.zoneGlyph}>{meta.glyph}</span>
      <span className={styles.zoneLabel}>{meta.label}</span>
    </div>
  )
}

const ZONE_META: Record<SplitZone, { glyph: string; label: string; pos: 'center' | 'above' | 'below' | 'left' | 'right' }> = {
  center: { glyph: '↔', label: 'Swap', pos: 'center' },
  above: { glyph: '⬆', label: 'Insert above', pos: 'above' },
  below: { glyph: '⬇', label: 'Insert below', pos: 'below' },
  left: { glyph: '⬅', label: 'Insert left', pos: 'left' },
  right: { glyph: '➡', label: 'Insert right', pos: 'right' },
}
