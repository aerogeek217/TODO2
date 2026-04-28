import { cloneElement, isValidElement, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { RailSide } from '../../../models/canvas-rails'
import { railOrientationForSide } from '../../../models/canvas-rails'
import { Slot } from './Slot'
import { encodeRailsDropId, pointerToSplitZone, RAILS_DRAG_ID_SLOT_PREFIX, RAILS_DRAG_TYPE, type RailsDragData, type SplitZone } from '../../../utils/rail-dnd'
import { useUIStore } from '../../../stores/ui-store'
import styles from './DraggableSlot.module.css'

interface DraggableSlotProps {
  slotId: string
  fromSide: RailSide
  header: ReactElement
  children: ReactNode
  flex?: number
  bodyRole?: string
  bodyLabelledBy?: string
}

export function DraggableSlot({ slotId, fromSide, header, children, flex, bodyRole, bodyLabelledBy }: DraggableSlotProps) {
  const dragId = `${RAILS_DRAG_ID_SLOT_PREFIX}${slotId}`
  const dropId = encodeRailsDropId({ kind: 'slot', slotId })
  const dragData: RailsDragData = { type: RAILS_DRAG_TYPE, kind: 'slot', slotId, fromSide }

  const draggable = useDraggable({ id: dragId, data: dragData })
  const droppable = useDroppable({ id: dropId, data: { type: RAILS_DRAG_TYPE, slotId } })
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<{ zone: SplitZone; dragKind: DragKind } | null>(null)
  // React-Flow-driven float drags bypass dnd-kit, so `droppable.isOver` never
  // fires while a floating widget is being dragged over this slot. Read the
  // `floatDrag` slice directly so we can attach our own pointer listener and
  // surface the same ZoneIndicator hover feedback during float drags as we do
  // for dnd-kit slot / tab drags.
  const floatDragActive = useUIStore((s) => s.floatDrag !== null)

  // When this slot is being hovered by an active drag (and it isn't the source
  // itself), track the pointer against its rect and surface which zone the
  // pointer is in so the user can predict the outcome (swap vs insert) before
  // releasing. Active during either dnd-kit drags (`droppable.isOver`) or
  // float drags (`floatDragActive`); for float drags we additionally gate the
  // zone update on the pointer actually being inside the slot's rect because
  // we only have a global listener, not per-droppable `isOver`.
  //
  // We also record the drag *kind* (slot pill vs floating widget) on the hover
  // tuple — `ZoneIndicator` picks distinct labels + colors per kind so the
  // user doesn't see "Swap" while dragging a float (which actually merges as a
  // new tab). Source: triage-2026-04-27 item 5.
  useEffect(() => {
    const slotDragOver = droppable.isOver && !draggable.isDragging
    const active = slotDragOver || floatDragActive
    if (!active || draggable.isDragging) {
      setHover(null)
      return
    }
    const dragKind: DragKind = slotDragOver ? 'slot' : 'float'
    const orientation = railOrientationForSide(fromSide)
    const gateToRect = floatDragActive && !droppable.isOver
    const onMove = (e: PointerEvent) => {
      const el = wrapRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (gateToRect) {
        const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                       e.clientY >= rect.top && e.clientY <= rect.bottom
        if (!inside) {
          setHover(null)
          return
        }
      }
      const zone = pointerToSplitZone(
        { x: e.clientX, y: e.clientY },
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        orientation,
      )
      setHover({ zone, dragKind })
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
    }
  }, [droppable.isOver, draggable.isDragging, fromSide, floatDragActive])

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
    (droppable.isOver || hover != null) ? styles.over : '',
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
      data-rails-drop-id={dropId}
      style={style}
    >
      <Slot header={headerWithHandle} bodyRole={bodyRole} bodyLabelledBy={bodyLabelledBy}>{children}</Slot>
      {hover && <ZoneIndicator zone={hover.zone} dragKind={hover.dragKind} />}
    </div>
  )
}

type DragKind = 'slot' | 'float'
type ZoneOutcomeKind = 'swap' | 'insert' | 'addTab' | 'newSlot'
type ZonePos = 'center' | 'above' | 'below' | 'left' | 'right'

interface ZoneMeta {
  glyph: string
  label: string
  pos: ZonePos
  kind: ZoneOutcomeKind
}

function ZoneIndicator({ zone, dragKind }: { zone: SplitZone; dragKind: DragKind }) {
  const meta = (dragKind === 'float' ? FLOAT_ZONE_META : SLOT_ZONE_META)[zone]
  const testId = `${meta.kind}-indicator`
  const className = `${styles.zoneIndicator} ${styles[meta.pos]} ${styles[meta.kind]}`
  return (
    <div
      className={className}
      aria-hidden="true"
      data-testid={testId}
      data-zone={zone}
      data-drag-kind={dragKind}
      data-outcome={meta.kind}
    >
      <span className={styles.zoneGlyph}>{meta.glyph}</span>
      <span className={styles.zoneLabel}>{meta.label}</span>
    </div>
  )
}

// Slot drags (a rail slot's pill being moved): center swaps two slots in place;
// edges insert the source slot adjacent to the target.
const SLOT_ZONE_META: Record<SplitZone, ZoneMeta> = {
  center: { glyph: '↔', label: 'Swap', pos: 'center', kind: 'swap' },
  above: { glyph: '⬆', label: 'Insert above', pos: 'above', kind: 'insert' },
  below: { glyph: '⬇', label: 'Insert below', pos: 'below', kind: 'insert' },
  left: { glyph: '⬅', label: 'Insert left', pos: 'left', kind: 'insert' },
  right: { glyph: '➡', label: 'Insert right', pos: 'right', kind: 'insert' },
}

// Float drags (a canvas widget being moved onto a rail): center merges as a
// new tab in the existing slot; edges create a new slot adjacent in the rail.
// "Swap" is never an outcome — addressing triage-2026-04-27 item 5 ("Sometimes
// shows swap when in fact it becomes a new tab").
const FLOAT_ZONE_META: Record<SplitZone, ZoneMeta> = {
  center: { glyph: '＋', label: 'Add tab', pos: 'center', kind: 'addTab' },
  above: { glyph: '⬆', label: 'New slot above', pos: 'above', kind: 'newSlot' },
  below: { glyph: '⬇', label: 'New slot below', pos: 'below', kind: 'newSlot' },
  left: { glyph: '⬅', label: 'New slot left', pos: 'left', kind: 'newSlot' },
  right: { glyph: '➡', label: 'New slot right', pos: 'right', kind: 'newSlot' },
}
