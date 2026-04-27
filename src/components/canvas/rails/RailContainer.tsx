import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { Rail, RailSide, Slot, SlotKind } from '../../../models/canvas-rails'
import { clampRailSize } from '../../../models/canvas-rails'
import { useCanvasRailsStore } from '../../../stores/canvas-rails-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useUIStore } from '../../../stores/ui-store'
import { KIND_ICON } from '../../../utils/slot-kind'
import { getActiveTab } from '../../../models/canvas-rails'
import { encodeRailsDropId, nearestStubSlotId, RAILS_DRAG_TYPE } from '../../../utils/rail-dnd'
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

interface RailEdgeStripProps {
  side: RailSide
  size: number
  collapsed: boolean
  onResize: (px: number) => void
  onExpand: () => void
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
 * Visible 1px divider on the canvas-facing edge with a wider invisible hit
 * zone. When the rail is expanded, drag resizes (click is a no-op). When the
 * rail is collapsed, click expands the rail (drag is suppressed since there's
 * no width to resize). Keyboard collapse/expand lives on the chevron in the
 * first slot's TabStrip chrome.
 */
function RailEdgeStrip({ side, size, collapsed, onResize, onExpand }: RailEdgeStripProps) {
  const axis = side === 'left' || side === 'right' ? 'x' : 'y'
  const dragRef = useRef<{
    startCoord: number
    startSize: number
    pointerId: number
    moved: boolean
  } | null>(null)
  const { schedule, flush, pendingRef } = useThrottledResize(onResize)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = {
      startCoord: axis === 'x' ? e.clientX : e.clientY,
      startSize: size,
      pointerId: e.pointerId,
      moved: false,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const delta = (axis === 'x' ? e.clientX : e.clientY) - drag.startCoord
    if (!drag.moved && Math.abs(delta) >= DRAG_THRESHOLD_PX) {
      drag.moved = true
    }
    if (!drag.moved || collapsed) return
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
    if (collapsed && !drag.moved) {
      onExpand()
      return
    }
    if (pendingRef.current != null) flush()
  }

  const className = `${styles.edgeStrip} ${styles[`edgeStrip_${side}`]} ${collapsed ? styles.edgeStrip_collapsed : ''}`
  const ariaLabel = collapsed ? `Expand ${side} rail` : `Resize ${side} rail`
  return (
    <div
      className={className}
      role={collapsed ? 'button' : 'separator'}
      aria-label={ariaLabel}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      title={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

/** Direction the rail's canvas-facing edge moves on expand (toward canvas). */
function expandGlyph(side: RailSide): string {
  if (side === 'left') return '▸'
  if (side === 'right') return '◂'
  if (side === 'top') return '▾'
  return '▴'
}

/** Title-cased label shown in the collapsed strip next to each slot's kind icon. */
const KIND_DISPLAY: Record<SlotKind, string> = {
  lens: 'List',
  notes: 'Notes',
  calendar: 'Calendar',
  taskboard: 'Taskboard',
  horizons: 'Horizons',
  status: 'Status',
  scoreboard: 'Discipline',
  snoozeGraveyard: 'Snooze graveyard',
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
  /**
   * True when this stub is the aside-level nearest-stub during a float drag
   * (triage-2026-04-27 P5). Drives `.iconStubOver` independently of
   * `droppable.isOver` so the user sees a visible target even when the
   * pointer is on the rail aside's margin / between stubs / outside any
   * stub's individual rect.
   */
  highlightFromAside: boolean
}

function CollapsedSlotStub({ slot, highlightFromAside }: CollapsedSlotStubProps) {
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
  // React-Flow-driven float drags bypass dnd-kit, so `droppable.isOver` never
  // fires while a floating widget is being dragged over the stub. The
  // aside-level pointer listener in `RailContainer` computes the nearest
  // stub during a float drag and threads `highlightFromAside` down — that
  // path covers the inside-stub case (nearest = the one you're inside) plus
  // margin / between-stub / aside-padding gaps, replacing the per-stub
  // pointer-inside shortcut. `droppable.isOver` still drives the dnd-kit
  // slot/tab drag highlight.
  const hoverActive = droppable.isOver || highlightFromAside
  return (
    <div
      ref={droppable.setNodeRef}
      className={`${styles.iconStub} ${hoverActive ? styles.iconStubOver : ''}`}
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

  // T3 (triage-2026-04-26): when collapsed, expose the entire `<aside>` as a
  // catch-all drop zone. The per-stub `rails:slot:<id>` zones still take
  // priority via `resolveFloatDockTarget`'s ordering — this fires only when
  // the release lands on the rail aside but misses every stub (margin / gap
  // between stubs / top/bottom padding). The resolver bisects the contained
  // stubs by axis distance and routes the dock to the nearest one.
  const collapsedSideDropId = collapsed ? encodeRailsDropId({ kind: 'collapsed-side', side }) : undefined

  // P5 (triage-2026-04-27): aside-level "nearest stub" highlight for float
  // drags. React-Flow-driven float drags bypass dnd-kit, so individual stubs
  // never see `droppable.isOver` mid-drag. Lifting the pointer listener up to
  // the aside lets us highlight the nearest stub for *any* pointer position
  // inside the aside — including margin / between stubs / padding — so the
  // user always sees a visible dock target. Mirrors `nearestStubSlotId`'s
  // resolver-side bisection so the visible target and the actual dock target
  // can never diverge.
  const floatDragActive = useUIStore((s) => s.floatDrag !== null)
  const asideRef = useRef<HTMLElement | null>(null)
  const [nearestStubId, setNearestStubId] = useState<string | null>(null)
  useEffect(() => {
    if (!collapsed || !floatDragActive) {
      setNearestStubId(null)
      return
    }
    const onMove = (e: PointerEvent) => {
      const aside = asideRef.current
      if (!aside) return
      const rect = aside.getBoundingClientRect()
      const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top && e.clientY <= rect.bottom
      if (!inside) {
        setNearestStubId(null)
        return
      }
      setNearestStubId(nearestStubSlotId(aside, { x: e.clientX, y: e.clientY }, side))
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [collapsed, floatDragActive, side])

  return (
    <aside
      ref={asideRef}
      className={`${styles.rail} ${orientClass} ${styles[side]} ${collapsedClass}`}
      style={mergedStyle}
      data-rail-side={side}
      data-rail-collapsed={collapsed ? 'true' : 'false'}
      data-rails-drop-id={collapsedSideDropId}
      aria-label={`Canvas ${side} rail`}
    >
      {collapsed ? (
        <div className={styles.iconStrip}>
          <button
            type="button"
            className={`${styles.expandChevron} ${styles[`expandChevron_${side}`]}`}
            onClick={() => toggleRailCollapsed(side)}
            aria-label={`Expand ${side} rail`}
            title={`Expand ${side} rail`}
          >
            <span aria-hidden="true">{expandGlyph(side)}</span>
          </button>
          {rail.slots.map((slot) => (
            <CollapsedSlotStub
              key={slot.id}
              slot={slot}
              highlightFromAside={floatDragActive && nearestStubId === slot.id}
            />
          ))}
        </div>
      ) : (
        children
      )}
      <RailEdgeStrip
        side={side}
        size={size}
        collapsed={collapsed}
        onResize={onResize}
        onExpand={() => toggleRailCollapsed(side)}
      />
    </aside>
  )
}
