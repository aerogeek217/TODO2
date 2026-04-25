import { useCallback, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { Rail, RailSide, Slot, SlotKind } from '../../../models/canvas-rails'
import { RAIL_SIZE_MAX, RAIL_SIZE_MIN, clampRailSize } from '../../../models/canvas-rails'
import { useCanvasRailsStore } from '../../../stores/canvas-rails-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { KIND_ICON } from '../../../utils/slot-kind'
import { getActiveTab } from '../../../models/canvas-rails'
import { encodeRailsDropId, RAILS_DRAG_TYPE } from '../../../utils/rail-dnd'
import styles from './RailContainer.module.css'

interface RailContainerProps {
  side: RailSide
  rail: Rail
  size: number
  collapsed?: boolean
  onResize: (px: number) => void
  children: ReactNode
  /** Extra inline styles (e.g. `grid-area` from the frame grid). Merged over the size style. */
  style?: CSSProperties
}

interface RailEdgeHandleProps {
  side: RailSide
  size: number
  collapsed: boolean
  onResize: (px: number) => void
  onToggleCollapse: () => void
}

interface RailEdgeStripProps {
  side: RailSide
  size: number
  onResize: (px: number) => void
}

/** Pointer-travel threshold to distinguish a click (<threshold) from a drag. */
const DRAG_THRESHOLD_PX = 3

/**
 * Shared rAF scheduler used by both the edge-strip and edge-handle so drag
 * updates coalesce at at most one `onResize` per frame.
 */
function useThrottledResize(onResize: (px: number) => void) {
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

  const flush = useCallback(() => {
    const latest = pendingRef.current
    pendingRef.current = null
    if (latest != null) onResize(latest)
  }, [onResize])

  useEffect(() => () => {
    if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
  }, [])

  return { schedule, flush, pendingRef }
}

/**
 * Invisible drag strip along the full canvas-facing edge. Drag-only — no
 * click-to-toggle, unlike `RailEdgeHandle`. Provides a forgiving target for
 * users who don't aim for the centered button.
 */
function RailEdgeStrip({ side, size, onResize }: RailEdgeStripProps) {
  const axis = side === 'left' || side === 'right' ? 'x' : 'y'
  const dragRef = useRef<{ startCoord: number; startSize: number; pointerId: number } | null>(null)
  const { schedule, flush, pendingRef } = useThrottledResize(onResize)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
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
    if (pendingRef.current != null) flush()
  }

  return (
    <div
      className={`${styles.edgeStrip} ${styles[`edgeStrip_${side}`]}`}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

/**
 * Small button centered on the canvas-facing edge. Click toggles collapse;
 * drag resizes past `DRAG_THRESHOLD_PX` of movement. No auto-collapse from
 * drag — use the button or keyboard to collapse.
 */
function RailEdgeHandle({ side, size, collapsed, onResize, onToggleCollapse }: RailEdgeHandleProps) {
  const axis = side === 'left' || side === 'right' ? 'x' : 'y'
  const dragRef = useRef<{
    startCoord: number
    startSize: number
    pointerId: number
    moved: boolean
  } | null>(null)
  const { schedule, flush, pendingRef } = useThrottledResize(onResize)

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    // jsdom lacks pointer capture; guard so tests don't blow up.
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = {
      startCoord: axis === 'x' ? e.clientX : e.clientY,
      startSize: size,
      pointerId: e.pointerId,
      moved: false,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const delta = (axis === 'x' ? e.clientX : e.clientY) - drag.startCoord
    if (!drag.moved && Math.abs(delta) >= DRAG_THRESHOLD_PX) {
      drag.moved = true
    }
    if (!drag.moved || collapsed) return
    // Canvas-facing edge direction: left/top rails grow with +delta; right/bottom rails grow with −delta.
    const sign = side === 'left' || side === 'top' ? 1 : -1
    schedule(clampRailSize(drag.startSize + sign * delta))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (!drag.moved) {
      // Click: toggle collapse.
      onToggleCollapse()
      return
    }
    if (pendingRef.current != null) flush()
  }

  // Keyboard: Enter/Space toggle collapse; arrow-key resize in 20 px steps.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggleCollapse()
      return
    }
    if (collapsed) return
    const STEP = 20
    let delta = 0
    if (axis === 'x') {
      if (e.key === 'ArrowLeft') delta = side === 'left' ? -STEP : STEP
      else if (e.key === 'ArrowRight') delta = side === 'left' ? STEP : -STEP
    } else {
      if (e.key === 'ArrowUp') delta = side === 'top' ? -STEP : STEP
      else if (e.key === 'ArrowDown') delta = side === 'top' ? STEP : -STEP
    }
    if (delta === 0) return
    e.preventDefault()
    onResize(clampRailSize(size + delta))
  }

  const label = `${collapsed ? 'Expand' : 'Collapse'} ${side} rail (click) or drag to resize`
  const glyph = collapseGlyph(side, collapsed)

  return (
    <button
      type="button"
      className={`${styles.edgeHandle} ${styles[`edgeHandle_${side}`]}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-pressed={collapsed}
      aria-valuemin={RAIL_SIZE_MIN}
      aria-valuemax={RAIL_SIZE_MAX}
      aria-valuenow={size}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  )
}

/**
 * Small black triangle pointing in the direction the rail's canvas-facing edge
 * will move when the button is clicked. Expanded rail → click collapses → edge
 * moves toward the viewport edge; collapsed rail → click expands → edge moves
 * toward the canvas center. Uses U+25B4/B8/BE/C2 (▴ ▸ ▾ ◂) rather than the
 * U+2303/04 arrowheads, whose visible marks sit off-center within the em box.
 */
function collapseGlyph(side: RailSide, collapsed: boolean): string {
  if (side === 'left') return collapsed ? '▸' : '◂'
  if (side === 'right') return collapsed ? '◂' : '▸'
  if (side === 'top') return collapsed ? '▾' : '▴'
  return collapsed ? '▴' : '▾'
}

/** Title-cased label shown in the collapsed strip next to each slot's kind icon. */
const KIND_DISPLAY: Record<SlotKind, string> = {
  lens: 'List',
  notes: 'Notes',
  calendar: 'Calendar',
  taskboard: 'Taskboard',
  horizons: 'Horizons',
}

function useSlotStubLabel(slot: Slot): string {
  const active = getActiveTab(slot)
  const listDef = useListDefinitionStore((s) =>
    active.type === 'lens' && active.listDefinitionId != null
      ? s.listDefinitions.find((d) => d.id === active.listDefinitionId)
      : undefined
  )
  if (active.type === 'lens') return listDef?.name ?? KIND_DISPLAY.lens
  return KIND_DISPLAY[active.type]
}

interface CollapsedSlotStubProps {
  slot: Slot
}

function CollapsedSlotStub({ slot }: CollapsedSlotStubProps) {
  const active = getActiveTab(slot)
  const label = useSlotStubLabel(slot)
  // P5 fix: collapsed rails render stubs in place of `DraggableSlot`, so the
  // expanded-state `rails:slot:<id>` drop zone disappears with the body.
  // Register the same id on the stub so float drags + dnd-kit slot/tab drags
  // both treat the collapsed stub as the slot's drop target. `pointerWithin`
  // matches via the stub's small rect, and `resolveFloatDockTarget` walks
  // `elementsFromPoint` for the `data-rails-drop-id` attribute.
  const dropId = encodeRailsDropId({ kind: 'slot', slotId: slot.id })
  const droppable = useDroppable({ id: dropId, data: { type: RAILS_DRAG_TYPE, slotId: slot.id } })
  return (
    <div
      ref={droppable.setNodeRef}
      className={`${styles.iconStub} ${droppable.isOver ? styles.iconStubOver : ''}`}
      title={label}
      data-rails-drop-id={dropId}
      data-slot-id={slot.id}
    >
      <span className={styles.iconStubIcon} aria-hidden="true">{KIND_ICON[active.type]}</span>
      <span className={styles.iconStubLabel}>{label}</span>
    </div>
  )
}

export function RailContainer({ side, rail, size, collapsed = false, onResize, children, style }: RailContainerProps) {
  const toggleRailCollapsed = useCanvasRailsStore((s) => s.toggleRailCollapsed)
  const orientClass = rail.orientation === 'vertical' ? styles.vertical : styles.horizontal
  const sizeStyle: CSSProperties = rail.orientation === 'vertical' ? { width: size } : { height: size }
  const mergedStyle: CSSProperties = style ? { ...sizeStyle, ...style } : sizeStyle
  const collapsedClass = collapsed ? styles.collapsed : ''

  return (
    <aside
      className={`${styles.rail} ${orientClass} ${styles[side]} ${collapsedClass}`}
      style={mergedStyle}
      data-rail-side={side}
      data-rail-collapsed={collapsed ? 'true' : 'false'}
      aria-label={`Canvas ${side} rail`}
    >
      {collapsed ? (
        <div className={styles.iconStrip}>
          {rail.slots.map((slot) => (
            <CollapsedSlotStub key={slot.id} slot={slot} />
          ))}
        </div>
      ) : (
        children
      )}
      {!collapsed && <RailEdgeStrip side={side} size={size} onResize={onResize} />}
      <RailEdgeHandle
        side={side}
        size={size}
        collapsed={collapsed}
        onResize={onResize}
        onToggleCollapse={() => toggleRailCollapsed(side)}
      />
    </aside>
  )
}
