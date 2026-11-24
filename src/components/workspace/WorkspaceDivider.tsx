import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { registerModuleReset } from '../../utils/module-reset'
import { flushSync } from 'react-dom'
import type { GridAxis, LayoutBody } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { afterLeavingEditors } from '../../stores/editor-leave'
import { isWholeLine, type EdgeStretch } from '../../utils/workspace-grid'
import { dividerBreaksOff, dividerMoveStretch, dividerTooltip } from '../../utils/divider-moves'
import { edgeSnapLine, evenStretchDelta, moveEdge, withRowDrawnAt, type MoveEdgeOptions } from '../../utils/workspace-layout-ops'
import { withoutTrackFitPx } from '../../utils/workspace-layout-sizes'
import { trackSizing } from '../../utils/workspace-table'
import { layoutStructureEqual } from '../../utils/workspace-layout-queries'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { shortcutScope } from '../../utils/dom-contract'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon } from '../shared/icons'
import { drawnGap, drawnSizes, endLineOf, guidePlacement, KEY_STEP_PX, minPxIn, probeIds, recapture, showResizePreview, useDragPointer, useEscapeCancel } from './divider-drag'
import styles from './WorkspaceDivider.module.css'

/** A divider's `aria-valuenow`, with its `aria-valuemax` (none for a px size) and `aria-valuetext`. */
export interface DividerValue {
  now: number
  max?: number
  text?: string
}

/** What a divider's collapse pill collapses on each side of its stretch: track ids, none for no button there. */
export interface DividerCollapse {
  before: readonly string[]
  after: readonly string[]
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
  /** Its stretch is part of its line (not the whole of it): Alt-drag breaks it off (its tooltip says so). */
  partOfLine?: boolean
  /** Its collapse pill (outside the layout edit mode): the tracks each of its buttons collapses. Absent: no pill. */
  collapse?: DividerCollapse
}

/**
 * A pill button's name: `Collapse the column on the left`, `Collapse the
 * rows below` — plural when it collapses more than one track.
 */
function collapsePillLabel(axis: GridAxis, side: 'before' | 'after', count: number): string {
  const noun = axis === 'columns' ? 'column' : 'row'
  const where = axis === 'columns' ? (side === 'before' ? 'on the left' : 'on the right') : (side === 'before' ? 'above' : 'below')
  return `Collapse the ${noun}${count > 1 ? 's' : ''} ${where}`
}

/**
 * A divider's collapse pill, drawn after it and its line (CSS shows it from
 * the divider's hover, after 120ms, or focus, and while it is hovered or
 * holds the focus): between columns ◂ ▸, between rows ▴ ▾, each collapsing
 * the tracks on its side (`setTrackCollapsed`, view state — no undo step,
 * as Collapse row). A sibling of the divider, not inside it: a press on it
 * never starts a resize.
 */
function CollapsePill({ axis, collapse, style }: { axis: GridAxis; collapse: DividerCollapse; style: CSSProperties }) {
  const sides = (['before', 'after'] as const).filter((side) => collapse[side].length > 0)
  if (sides.length === 0) return null
  const run = (ids: readonly string[]) => afterLeavingEditors(() => { void useWorkspaceStore.getState().setTrackCollapsed(ids, true) })
  const icon = (side: 'before' | 'after') => (axis === 'columns'
    ? (side === 'before' ? <ChevronLeftIcon size={12} /> : <ChevronRightIcon size={12} />)
    : (side === 'before' ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />))
  return (
    <div className={`${styles.pillWrap} ${axis === 'columns' ? styles.pillColumns : styles.pillRows}`} style={style} data-ws-divider-pill={axis}>
      <div className={styles.pill}>
        {sides.map((side) => {
          const label = collapsePillLabel(axis, side, collapse[side].length)
          return (
            <button
              key={side}
              type="button"
              className={styles.pillButton}
              aria-label={label}
              data-tooltip={label}
              onClick={() => run(collapse[side])}
            >
              {icon(side)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** What a divider drag keeps from its start. */
interface DragState {
  pointerId: number
  start: number
  layout: LayoutBody
  /** What the drag moves: its whole line, or with Alt its own piece (`dividerMoveStretch`). */
  moved: EdgeStretch
  /** Alt is held: the piece breaks off its line (read on every move, so it can change mid-drag). */
  breakOff: boolean
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
registerModuleReset(() => { refocusAfterKey = null })

/** A divider's identity: its axis and the first cells on either side (unique; kept across a move). */
function dividerIdentity(axis: GridAxis, beforeId: string, afterId: string): string {
  return `${axis}:${beforeId}|${afterId}`
}


/**
 * The faint accent guide along the whole grid line a drag has snapped onto
 * (`edgeSnapLine`): shown while it holds there, gone when it lets go or the
 * drag ends. Only an inner line (the outer edges are no snap target).
 */
function SnapGuide({ axis, line, tracks }: { axis: GridAxis; line: number; tracks: number }) {
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
 * between them is a divider of its own (`edgeStretches`). **A plain drag
 * moves the whole line** it lies on, across the crossings (layout edit mode
 * E4, decision B: `dividerMoveStretch`) — its two tracks share their size
 * anew, live, saved once at the end as view state (the mode's draft while
 * the mode is on); **Alt + drag moves only its own piece** (Alt can change
 * mid-drag), which leaves the line: a new line and track — or onto another
 * line, a piece snapped back onto a line it left re-joining it — previewed
 * while the drag runs, every cell drawn at the size and place the release
 * gives it (`workspace-store.resizePreview`), the release making that edit
 * (an undo step outside the mode). Either snaps onto any line of its axis
 * within 8px (a faint guide along that line while it holds), every cell
 * kept at its minimum; Esc, or a cancelled pointer, puts the table back as
 * it was. Its hover, focus and drag light what it moves: the whole line,
 * or with Alt its piece. Beside a Numbers-only row it always moves the
 * whole line, the row taking a height of its own (`fitTrackIds`; its
 * `fitPx`, view state). ←/→ (↑/↓) move the whole line 16px, Alt + them the
 * piece, the focus staying on it (a run of them is one undo step); a
 * double-click evens the whole line's two tracks (Alt: moves the piece
 * midway between its own cells), or lets a fit row fit again. Outside the
 * layout edit mode its hover or focus shows its collapse pill
 * (`CollapsePill`), which collapses the columns (rows) on either side.
 */
export function WorkspaceDivider({ stretch, beforeId, afterId, label, value, style, fitTrackIds = [], partOfLine = false, collapse }: WorkspaceDividerProps) {
  const axisX = stretch.axis === 'columns'
  const dragRef = useRef<DragState | null>(null)
  const elRef = useRef<HTMLDivElement | null>(null)
  const identity = dividerIdentity(stretch.axis, beforeId, afterId)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [snap, setSnap] = useState<{ line: number; tracks: number } | null>(null)
  /** Alt is held over it (or during its drag): it lights, and moves, its piece alone. */
  const [breaking, setBreaking] = useState(false)
  const [hovered, setHovered] = useState(false)
  const fit = fitTrackIds.length > 0
  // While hovered: Alt pressed or let go changes what it lights at once.
  useEffect(() => {
    if (!hovered) return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Alt' && !dragRef.current) setBreaking(e.type === 'keydown' && partOfLine && !fit) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [hovered, partOfLine, fit])
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
    setBreaking(false)
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

  /** What a move of this divider moves in `layout`: its whole line, or with Alt (`breakOff`) its piece. */
  const movedIn = (layout: LayoutBody, breakOff: boolean): EdgeStretch => dividerMoveStretch(layout, stretch, { breakOff, fit })

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
    if (e.altKey !== drag.breakOff) {
      drag.breakOff = e.altKey
      drag.moved = movedIn(drag.layout, e.altKey)
      setBreaking(dividerBreaksOff(drag.layout, stretch, { breakOff: e.altKey, fit }))
    }
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
      moved: movedIn(layout, e.altKey),
      breakOff: e.altKey,
      opts: { sizes, minPx: minPxIn(layout), gap: drawnGap(table, stretch.axis) },
      structural: false,
      delta: 0,
    }
    pointer.listen(onPointerMove, onPointerUp)
    setBreaking(dividerBreaksOff(layout, stretch, { breakOff: e.altKey, fit }))
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
    // Key steps on this divider are one undo step (when they move part of a line). Alt: its piece alone.
    void useWorkspaceStore.getState().moveEdge(movedIn(layout, e.altKey), e.key === grow ? KEY_STEP_PX : -KEY_STEP_PX, { sizes, minPx: minPxIn(layout), gap: drawnGap(table, stretch.axis) }, { mergeKey: `divider:${identity}` })
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
   * The whole line's two weighted tracks share their size evenly; with Alt,
   * part of a line moves, as an Alt-drag would, midway between its own cells
   * (`evenStretchDelta`) — the rest of its line stays. Beside a fit row
   * given a height, that height goes: the row fits its content again.
   */
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const layout = useWorkspaceStore.getState().working
    if (fit) {
      if (layout) clearFitHeights(layout, e.currentTarget.closest<HTMLElement>('[data-ws-table]'))
      return
    }
    if (layout && e.altKey && !isWholeLine(layout, stretch)) {
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
        data-tooltip={dragging ? undefined : dividerTooltip(partOfLine, fit)}
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
        data-fit={fit ? '' : undefined}
        data-preview={previewing ? '' : undefined}
        data-break={breaking ? '' : undefined}
        // Its arrow keys move it; none of the app shortcuts (↑ / ↓ select tasks).
        {...shortcutScope('none')}
        onPointerDown={onPointerDown}
        onPointerEnter={(e) => {
          setHovered(true)
          // Mid-drag the drag decides (a preview moving the element fires a fresh enter).
          if (!dragRef.current) setBreaking(e.altKey && partOfLine && !fit)
        }}
        onPointerLeave={() => {
          setHovered(false)
          if (!dragRef.current) setBreaking(false)
        }}
        onLostPointerCapture={(e) => recapture(e.currentTarget, e.pointerId, dragRef.current?.pointerId === e.pointerId)}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      />
      {/* The whole line it moves, lit by its hover, focus and drag (CSS: the sibling right after it) — not while Alt breaks its piece off. */}
      <div
        className={`${styles.lineLight} ${axisX ? styles.guideColumns : styles.guideRows}`}
        style={guidePlacement(stretch.axis, stretch.line)}
        aria-hidden="true"
        data-ws-divider-line={`${beforeId}|${afterId}`}
      />
      {collapse && <CollapsePill axis={stretch.axis} collapse={collapse} style={style} />}
      {snap && <SnapGuide axis={stretch.axis} line={snap.line} tracks={snap.tracks} />}
    </>
  )
}
