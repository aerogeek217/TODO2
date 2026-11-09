import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { GridAxis, LayoutBody } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { cellById, isWholeLine, spanOf, type EdgeStretch } from '../../utils/workspace-grid'
import { evenStretchDelta, moveEdge, type MoveEdgeOptions } from '../../utils/workspace-layout-ops'
import { layoutStructureEqual } from '../../utils/workspace-layout-queries'
import { cellMinPx, tableTrackSizes, trackStart } from '../../utils/workspace-table'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { shortcutScope } from '../../utils/dom-contract'
import { measureTableElement } from './measure'
import styles from './WorkspaceDivider.module.css'

/** Keyboard step for a focused divider (px). */
const KEY_STEP_PX = 16

/** A divider's `aria-valuenow`, with its `aria-valuemax` (none for a px size) and `aria-valuetext`. */
export interface DividerValue {
  now: number
  max?: number
  text?: string
}

interface WorkspaceDividerProps {
  /** The stretch of grid line it moves (`workspace-grid.edgeStretches`). */
  stretch: EdgeStretch
  /** The first cells on either side (its `data-ws-divider`, `<before>|<after>`). */
  beforeId: string
  afterId: string
  /** "Resize Notes and Calendar". */
  label: string
  /** Its value for assistive tech (`aria-valuenow` …). */
  value: DividerValue
  /** Where it sits in the table's grid (the gutter before the track after it). */
  style: CSSProperties
}

/** What a divider drag keeps from its start. */
interface DragState {
  pointerId: number
  start: number
  layout: LayoutBody
  opts: MoveEdgeOptions
  /** The table's room and gap along the axis, and its rows' drawn heights (for the preview). */
  available: number
  gap: number
  rowPx: ReadonlyMap<string, number>
  /** The last frame changed the structure (part of a line moved): drawn as a preview, applied on release. */
  structural: boolean
  delta: number
}

/** The table's tracks along `axis` as drawn (px), from its computed grid template. */
function drawnSizes(table: HTMLElement, axis: GridAxis): number[] {
  const style = getComputedStyle(table)
  const template = axis === 'columns' ? style.gridTemplateColumns : style.gridTemplateRows
  return template.split(' ').map((v) => Number.parseFloat(v)).filter((n) => Number.isFinite(n))
}

/** Each cell's minimum along an axis (`workspace-table.cellMinPx`: a collapsed cell's is its header). */
function minPxIn(layout: LayoutBody): MoveEdgeOptions['minPx'] {
  return (cell, axis) => cellMinPx(layout, cell, axis)
}

/**
 * The divider a key press just moved (`<axis>:<before>|<after>`): moving
 * part of a line renumbers the lines, so React may remount or move its
 * element and the focus would drop to the page — the divider of that
 * identity takes it back once drawn. Cleared on the next frame.
 */
let refocusAfterKey: string | null = null

/** A divider's identity: its axis and the first cells on either side (unique; kept across a move). */
function dividerIdentity(axis: GridAxis, beforeId: string, afterId: string): string {
  return `${axis}:${beforeId}|${afterId}`
}

/** Throwaway ids for a preview's probe (never stored). */
function probeIds(): () => string {
  let n = 0
  return () => `probe-${++n}`
}

/**
 * The px offset along the axis the stretch's line moves to in `next` from
 * where it is in `layout` (the first cell before it keeps its id and ends
 * on it): a preview of a move that changes the structure.
 */
function previewOffset(drag: DragState, stretch: EdgeStretch, next: LayoutBody, beforeId: string): number {
  const { axis } = stretch
  const cell = cellById(next, beforeId)
  if (!cell) return drag.delta
  const sizes = tableTrackSizes(next, axis, drag.available, drag.gap, drag.rowPx)
  const line = spanOf(cell.area, axis)[1]
  const at = trackStart(sizes, line, drag.gap)
  const was = trackStart(drag.opts.sizes, stretch.line, drag.gap)
  return at - was
}

/**
 * The gutter between the cells on either side of a stretch of grid line, as
 * a resize handle (D26 P2). A drag moves the stretch (`moveEdge`, snapping
 * onto another line within 8px, every cell kept at its minimum): when it is
 * the whole line, the two tracks beside it share their size anew, live,
 * saved once at the end as view state; when only part of it moves (a new
 * line), it previews where the line goes and makes that unsaved edit on
 * release. ←/→ (↑/↓) move it 16px, the focus staying on it; a double-click
 * evens a whole line's two tracks, or part of a line's own cells.
 */
export function WorkspaceDivider({ stretch, beforeId, afterId, label, value, style }: WorkspaceDividerProps) {
  const axisX = stretch.axis === 'columns'
  const dragRef = useRef<DragState | null>(null)
  const elRef = useRef<HTMLDivElement | null>(null)
  const identity = dividerIdentity(stretch.axis, beforeId, afterId)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)

  // Gone mid-drag: what the frames applied is kept all the same.
  const endRef = useLatestRef(() => { void useWorkspaceStore.getState().endResize() })
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    if (dragRef.current) endRef.current()
  }, [endRef])

  // After a key press moved it: keep the focus on it (remounted or moved).
  useLayoutEffect(() => {
    if (refocusAfterKey !== identity) return
    refocusAfterKey = null
    const el = elRef.current
    if (el && document.activeElement !== el) el.focus()
  })

  /** Applies one frame: a whole-line move live; a structural one only previewed (the sizes back to the start). */
  const frame = (delta: number) => {
    const drag = dragRef.current
    if (!drag) return
    drag.delta = delta
    const store = useWorkspaceStore.getState()
    const next = moveEdge(drag.layout, stretch, delta, drag.opts, probeIds())
    const structural = next !== drag.layout && !layoutStructureEqual(next, drag.layout)
    const sizesOf = (body: LayoutBody) => Object.fromEntries(body.grid[stretch.axis].map((t) => [t.id, t.px ?? t.weight ?? 0]))
    void store.setTrackSizes(sizesOf(structural ? drag.layout : next), { live: true })
    drag.structural = structural
    setPreview(structural ? previewOffset(drag, stretch, next, beforeId) : null)
  }

  const flush = () => {
    rafRef.current = null
    const delta = pendingRef.current
    pendingRef.current = null
    if (delta != null) frame(delta)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const layout = useWorkspaceStore.getState().working
    const table = e.currentTarget.closest<HTMLElement>('[data-ws-table]')
    if (!layout || !table) return
    const sizes = drawnSizes(table, stretch.axis)
    if (sizes.length !== layout.grid[stretch.axis].length) return
    const metrics = measureTableElement(table)
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      start: axisX ? e.clientX : e.clientY,
      layout,
      opts: { sizes, minPx: minPxIn(layout) },
      available: axisX ? metrics.width : metrics.height,
      gap: metrics.gap,
      rowPx: new Map(Object.entries(metrics.rowPx)),
      structural: false,
      delta: 0,
    }
    setDragging(true)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    pendingRef.current = (axisX ? e.clientX : e.clientY) - drag.start
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      flush()
    }
    dragRef.current = null
    setDragging(false)
    setPreview(null)
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const store = useWorkspaceStore.getState()
    // The live frames' sizes saved first (a structural move put them back to the start).
    void store.endResize()
    if (drag.structural && e.type === 'pointerup') void store.moveEdge(stretch, drag.delta, drag.opts)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = axisX ? 'ArrowRight' : 'ArrowDown'
    const shrink = axisX ? 'ArrowLeft' : 'ArrowUp'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    const layout = useWorkspaceStore.getState().working
    const table = e.currentTarget.closest<HTMLElement>('[data-ws-table]')
    if (!layout || !table) return
    const sizes = drawnSizes(table, stretch.axis)
    if (sizes.length !== layout.grid[stretch.axis].length) return
    refocusAfterKey = identity
    requestAnimationFrame(() => { if (refocusAfterKey === identity) refocusAfterKey = null })
    void useWorkspaceStore.getState().moveEdge(stretch, e.key === grow ? KEY_STEP_PX : -KEY_STEP_PX, { sizes, minPx: minPxIn(layout) })
  }

  /**
   * A whole line's two weighted tracks share their size evenly; part of a
   * line moves, as a drag would, midway between its own cells
   * (`evenStretchDelta`) — the rest of its line stays.
   */
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const layout = useWorkspaceStore.getState().working
    if (layout && !isWholeLine(layout, stretch)) {
      const table = e.currentTarget.closest<HTMLElement>('[data-ws-table]')
      const sizes = table ? drawnSizes(table, stretch.axis) : []
      const delta = evenStretchDelta(layout, stretch, sizes)
      if (delta != null) void useWorkspaceStore.getState().moveEdge(stretch, delta, { sizes, minPx: minPxIn(layout) })
      return
    }
    const tracks = layout?.grid[stretch.axis]
    const a = tracks?.[stretch.line - 1]
    const b = tracks?.[stretch.line]
    if (!a || !b || a.px != null || b.px != null) return
    const half = ((a.weight ?? 0) + (b.weight ?? 0)) / 2
    void useWorkspaceStore.getState().setTrackSizes({ [a.id]: half, [b.id]: half })
  }

  const shift = preview != null ? (axisX ? `translateX(${preview}px)` : `translateY(${preview}px)`) : undefined
  return (
    <div
      ref={elRef}
      className={`${styles.divider} ${axisX ? styles.betweenColumns : styles.betweenCells} ${dragging ? styles.dragging : ''}`}
      style={{ ...style, ...(shift ? { transform: shift } : {}) }}
      role="separator"
      aria-orientation={axisX ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value.now)}
      aria-valuemin={0}
      aria-valuemax={value.max}
      aria-valuetext={value.text}
      aria-label={label}
      tabIndex={0}
      data-ws-divider={`${beforeId}|${afterId}`}
      data-axis={stretch.axis}
      data-preview={preview != null ? '' : undefined}
      // Its arrow keys move it; none of the app shortcuts (↑ / ↓ select tasks).
      {...shortcutScope('none')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    />
  )
}
