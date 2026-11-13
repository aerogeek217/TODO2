import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import type { GridAxis, LayoutBody } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { isWholeLine, wholeLine, type EdgeStretch } from '../../utils/workspace-grid'
import { edgeSnapLine, evenStretchDelta, moveEdge, withRowDrawnAt, type MoveEdgeOptions } from '../../utils/workspace-layout-ops'
import { withoutTrackFitPx } from '../../utils/workspace-layout-sizes'
import { trackSizing } from '../../utils/workspace-table'
import { layoutStructureEqual } from '../../utils/workspace-layout-queries'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { shortcutScope } from '../../utils/dom-contract'
import { drawnGap, drawnSizes, endLineOf, guidePlacement, KEY_STEP_PX, minPxIn, probeIds, recapture, showResizePreview, useDragPointer, useEscapeCancel } from './divider-drag'
import styles from './WorkspaceDivider.module.css'

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
  /**
   * The Numbers-only (fit) rows beside it (track ids), when there are any:
   * a drag moves its whole line, giving such a row a fixed height (its
   * track's px, view state); a double-click clears the px, and the row
   * fits again.
   */
  fitTrackIds?: readonly string[]
}

/** What a divider drag keeps from its start. */
interface DragState {
  pointerId: number
  start: number
  layout: LayoutBody
  /** What the drag moves: the divider's stretch, or beside a fit row its whole line. */
  moved: EdgeStretch
  opts: MoveEdgeOptions
  /** The last frame changed the structure (part of a line moved): drawn as a preview, applied on release. */
  structural: boolean
  delta: number
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


/**
 * The faint accent guide along the whole grid line a drag has snapped onto
 * (`edgeSnapLine`): shown while it holds there, gone when it lets go or the
 * drag ends. Only an inner line (the outer edges are no snap target).
 */
export function SnapGuide({ axis, line, tracks }: { axis: GridAxis; line: number; tracks: number }) {
  if (line < 1 || line >= tracks) return null
  return (
    <div
      className={`${styles.guide} ${axis === 'columns' ? styles.guideColumns : styles.guideRows}`}
      style={guidePlacement(axis, line)}
      aria-hidden="true"
      data-testid="ws-snap-guide"
      data-axis={axis}
      data-line={line}
    />
  )
}

/**
 * The gutter between the cells on either side of a stretch of grid line, as
 * a resize handle (D26 P2). A line parts at its "+" crossings, so each piece
 * between them is a divider of its own (`edgeStretches`). A drag moves the
 * stretch (`moveEdge`, snapping onto any line of the axis within 8px —
 * a faint guide along that line while it holds —, every cell kept at its
 * minimum): when it holds every edge on its line, the two tracks beside it
 * share their size anew, live, saved once at the end as view state; when
 * only part of a line moves (a new line, or onto another line: a piece
 * snapped back onto a line it left re-joins it), the table previews the
 * result — every cell drawn at the size and place the release gives it
 * (`workspace-store.resizePreview`), this divider on its new line — and the
 * release makes that edit, an undo step (Esc, or a cancelled pointer, puts the
 * table back as it was). Beside a Numbers-only row it moves
 * the whole line, the row taking a height of its own (`fitTrackIds`; its
 * `fitPx`, view state). ←/→ (↑/↓)
 * move it 16px, the focus staying on it (a run of them moving part of a
 * line is one undo step); a double-click evens a whole
 * line's two tracks, or part of a line's own cells, or lets a fit row fit
 * again.
 */
export function WorkspaceDivider({ stretch, beforeId, afterId, label, value, style, fitTrackIds = [] }: WorkspaceDividerProps) {
  const axisX = stretch.axis === 'columns'
  const dragRef = useRef<DragState | null>(null)
  const elRef = useRef<HTMLDivElement | null>(null)
  const identity = dividerIdentity(stretch.axis, beforeId, afterId)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [snap, setSnap] = useState<{ line: number; tracks: number } | null>(null)
  /** This divider as a preview's handle: as keyed when its drag started (it keeps that key through the preview). */
  const handle = { kind: 'divider', axis: stretch.axis, beforeId, afterId } as const

  // Gone mid-drag: what the frames applied is kept all the same; a preview goes.
  const endRef = useLatestRef(() => {
    showResizePreview(null, handle)
    void useWorkspaceStore.getState().endResize()
  })
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    if (dragRef.current) endRef.current()
  }, [endRef])

  /** Ends the drag under way (its frames and state); returns what it kept. */
  const stopDrag = (): DragState | null => {
    const drag = dragRef.current
    if (!drag) return null
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    pendingRef.current = null
    dragRef.current = null
    pointer.unlisten()
    setDragging(false)
    setPreviewing(false)
    setSnap(null)
    const el = elRef.current
    if (el?.hasPointerCapture?.(drag.pointerId)) el.releasePointerCapture(drag.pointerId)
    return drag
  }

  // Its pointer's moves and release, wherever they go (listened to from the press).
  const pointer = useDragPointer()

  // Esc mid-drag: the table back as it was when the drag started.
  useEscapeCancel(dragging, () => {
    const drag = stopDrag()
    if (!drag) return
    const store = useWorkspaceStore.getState()
    void store.copyTrackSizes(drag.layout, [stretch.axis], { live: true })
    showResizePreview(null, handle)
    void store.endResize()
  })

  // After a key press moved it: keep the focus on it (remounted or moved).
  useLayoutEffect(() => {
    if (refocusAfterKey !== identity) return
    refocusAfterKey = null
    const el = elRef.current
    if (el && document.activeElement !== el) el.focus()
  })

  /** What a move of this divider moves in `layout`: its stretch, or beside a fit row the whole line. */
  const movedIn = (layout: LayoutBody): EdgeStretch => (fitTrackIds.length > 0 ? wholeLine(layout, stretch.axis, stretch.line) : stretch)

  /**
   * Applies one frame: a whole-line move live; a structural one previewed —
   * the table drawn as the release will leave it (`showResizePreview`), the
   * working copy's sizes back at the start, which the release's move is
   * computed from.
   */
  const frame = (delta: number) => {
    const drag = dragRef.current
    if (!drag) return
    drag.delta = delta
    const store = useWorkspaceStore.getState()
    const next = moveEdge(drag.layout, drag.moved, delta, drag.opts, probeIds())
    const structural = next !== drag.layout && !layoutStructureEqual(next, drag.layout)
    void store.copyTrackSizes(structural ? drag.layout : next, [stretch.axis], { live: true })
    drag.structural = structural
    showResizePreview(structural ? next : null, handle)
    setPreviewing(structural)
    // The guide in the table as drawn: a preview's line is where this divider's cells now meet.
    const snapped = edgeSnapLine(drag.layout, drag.moved, delta, drag.opts)
    const drawn = structural ? next : drag.layout
    const line = snapped != null && structural ? (endLineOf(next, beforeId, stretch.axis) ?? snapped) : snapped
    setSnap(line != null ? { line, tracks: drawn.grid[stretch.axis].length } : null)
  }

  const flush = () => {
    rafRef.current = null
    const delta = pendingRef.current
    pendingRef.current = null
    if (delta != null) frame(delta)
  }

  const onPointerMove = (e: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    pendingRef.current = (axisX ? e.clientX : e.clientY) - drag.start
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (dragRef.current?.pointerId !== e.pointerId) return
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      flush()
    }
    const drag = stopDrag()
    if (!drag) return
    const store = useWorkspaceStore.getState()
    // The live frames' sizes saved first (a structural move put them back to the start).
    void store.endResize()
    if (drag.structural && e.type === 'pointerup') void store.moveEdge(drag.moved, drag.delta, drag.opts)
    // In the same event: the move's table replaces the preview's in one render.
    showResizePreview(null, handle)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const layout = useWorkspaceStore.getState().working
    const table = e.currentTarget.closest<HTMLElement>('[data-ws-table]')
    if (!layout || !table) return
    const sizes = drawnSizes(table, stretch.axis)
    if (sizes.length !== layout.grid[stretch.axis].length) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      start: axisX ? e.clientX : e.clientY,
      layout,
      moved: movedIn(layout),
      opts: { sizes, minPx: minPxIn(layout), gap: drawnGap(table, stretch.axis) },
      structural: false,
      delta: 0,
    }
    pointer.listen(onPointerMove, onPointerUp)
    setDragging(true)
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
    // Key steps on this divider are one undo step (when they move part of a line).
    void useWorkspaceStore.getState().moveEdge(movedIn(layout), e.key === grow ? KEY_STEP_PX : -KEY_STEP_PX, { sizes, minPx: minPxIn(layout), gap: drawnGap(table, stretch.axis) }, { mergeKey: `divider:${identity}` })
  }

  /**
   * The fit rows beside it lose the height a drag gave them and fit their
   * content again. One beside a weighted row: only this line moves (J14) —
   * the row is drawn fitting (at once, to measure its height), then the
   * weighted row across the line takes the difference, re-weighted so the
   * other rows keep their sizes (`withRowDrawnAt`), saved once as view state.
   */
  const clearFitHeights = (layout: LayoutBody, table: HTMLElement | null) => {
    const store = useWorkspaceStore.getState()
    const rows = layout.grid.rows
    const given = fitTrackIds.filter((id) => rows.some((t) => t.id === id && t.fitPx != null))
    if (given.length === 0) return
    const cleared = given.reduce((l, id) => withoutTrackFitPx(l, id), layout)
    const fitAt = rows.findIndex((t) => t.id === given[0])
    const across = fitAt === stretch.line - 1 ? stretch.line : stretch.line - 1
    const before = table ? drawnSizes(table, 'rows') : []
    const oneBesideWeighted = given.length === 1 && stretch.axis === 'rows' && trackSizing(layout, 'rows', across).kind === 'weighted'
    if (!table || !oneBesideWeighted || before.length !== rows.length) {
      for (const id of given) void store.clearTrackFitPx(id)
      return
    }
    flushSync(() => { void store.copyTrackSizes(cleared, ['rows'], { live: true }) })
    const fitted = drawnSizes(table, 'rows')[fitAt]
    if (fitted != null) {
      const grown = (before[across] ?? 0) + (before[fitAt] ?? 0) - fitted
      void store.copyTrackSizes(withRowDrawnAt(cleared, across, grown, before), ['rows'], { live: true })
    }
    void store.endResize()
  }

  /**
   * A whole line's two weighted tracks share their size evenly; part of a
   * line moves, as a drag would, midway between its own cells
   * (`evenStretchDelta`) — the rest of its line stays. Beside a fit row
   * given a height, that height goes: the row fits its content again.
   */
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const layout = useWorkspaceStore.getState().working
    if (fitTrackIds.length > 0) {
      if (layout) clearFitHeights(layout, e.currentTarget.closest<HTMLElement>('[data-ws-table]'))
      return
    }
    if (layout && !isWholeLine(layout, stretch)) {
      const table = e.currentTarget.closest<HTMLElement>('[data-ws-table]')
      const sizes = table ? drawnSizes(table, stretch.axis) : []
      const gap = table ? drawnGap(table, stretch.axis) : 0
      const delta = evenStretchDelta(layout, stretch, sizes, gap)
      if (delta != null) void useWorkspaceStore.getState().moveEdge(stretch, delta, { sizes, minPx: minPxIn(layout), gap })
      return
    }
    const tracks = layout?.grid[stretch.axis]
    const a = tracks?.[stretch.line - 1]
    const b = tracks?.[stretch.line]
    if (!a || !b || a.px != null || b.px != null) return
    const half = ((a.weight ?? 0) + (b.weight ?? 0)) / 2
    void useWorkspaceStore.getState().setTrackSizes({ [a.id]: half, [b.id]: half })
  }

  return (
    <>
      <div
        ref={elRef}
        className={`${styles.divider} ${axisX ? styles.betweenColumns : styles.betweenCells} ${dragging ? styles.dragging : ''}`}
        style={style}
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
        data-fit={fitTrackIds.length > 0 ? '' : undefined}
        data-preview={previewing ? '' : undefined}
        // Its arrow keys move it; none of the app shortcuts (↑ / ↓ select tasks).
        {...shortcutScope('none')}
        onPointerDown={onPointerDown}
        onLostPointerCapture={(e) => recapture(e.currentTarget, e.pointerId, dragRef.current?.pointerId === e.pointerId)}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      />
      {snap && <SnapGuide axis={stretch.axis} line={snap.line} tracks={snap.tracks} />}
    </>
  )
}
