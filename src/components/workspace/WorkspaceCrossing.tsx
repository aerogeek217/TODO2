import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { GridAxis, LayoutBody } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { wholeLine } from '../../utils/workspace-grid'
import { EDGE_SNAP_PX, edgeSnap, moveEdge, type MoveEdgeOptions } from '../../utils/workspace-layout-ops'
import { layoutStructureEqual } from '../../utils/workspace-layout-queries'
import { trackSizing } from '../../utils/workspace-table'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { shortcutScope } from '../../utils/dom-contract'
import { drawnSizes, endLineOf, guidePlacement, KEY_STEP_PX, minPxIn, probeIds, recapture, showResizePreview, useDragPointer, useEscapeCancel } from './divider-drag'
import { SnapGuide } from './WorkspaceDivider'
import styles from './WorkspaceDivider.module.css'

interface WorkspaceCrossingProps {
  /** The column line and the row line crossing here (`workspace-grid.lineCrossings`). */
  col: number
  row: number
  /** The cell above-left of the crossing: it ends on both lines (a structural move's preview places the handle by it). */
  cornerId: string
  /** Its `data-ws-crossing`: the cells above-left and below-right, `<a>|<b>` (its React key). */
  testId: string
}

/** One axis of a crossing drag: the whole line it moves and where it stands. */
interface AxisDrag {
  axis: GridAxis
  line: number
  opts: MoveEdgeOptions
  delta: number
  /** The last frame moved the line past or onto another (a structural edit, applied on release). */
  structural: boolean
}

interface DragState {
  pointerId: number
  x: number
  y: number
  layout: LayoutBody
  columns: AxisDrag
  rows: AxisDrag
  /** This drag's undo merge key: its two structural moves (one per axis) are one undo step. */
  mergeKey: string
}

/** The axis's whole line, as `moveEdge` takes it. */
function lineOf(layout: LayoutBody, a: Pick<AxisDrag, 'axis' | 'line'>) {
  return wholeLine(layout, a.axis, a.line)
}

/** Where a crossing handle sits: the gutters' square before the tracks after its two lines. */
function crossingPlacement(col: number, row: number): CSSProperties {
  return { gridColumn: `${col + 1} / span 1`, gridRow: `${row + 1} / span 1` }
}

/**
 * A crossing handle (D26 follow-ups, board BE): at a "+" where four cells
 * meet, a handle that moves both whole lines through it at once — the
 * level line with the pointer's y, the upright one with its x. Its hit area
 * reaches 9px past the gutters' square (24px), over the dividers; on hover
 * (after 120ms), on focus and while dragging it lights the two whole lines
 * it moves, across and down the table, as a divider lights its own. Each is
 * a whole-line move (`moveEdge` over `wholeLine`): its two tracks share
 * their size anew, live, saved once at the drag's end as view state; each
 * snaps back onto its own place within 8px (`snapHome`), so a mostly
 * vertical drag leaves the upright line where it was, and onto any other
 * line of its axis within reach (a structural edit, made on release — the
 * table meanwhile drawn as it will be, `workspace-store.resizePreview`;
 * Esc puts it back as it was; one drag is one undo step, also when both
 * lines land on another). A faint guide runs along a line while it
 * holds. ↑/↓ move the level line, ←/→ the upright one, 16px (a run of them
 * one undo step); a double-click evens both lines' tracks.
 */
export function WorkspaceCrossing({ col, row, cornerId, testId }: WorkspaceCrossingProps) {
  const dragRef = useRef<DragState | null>(null)
  const dragCountRef = useRef(0)
  const elRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<{ dx: number; dy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [guides, setGuides] = useState<{ axis: GridAxis; line: number; tracks: number }[]>([])
  /** This crossing as a preview's handle (it keeps its key, and sits by its corner cell, through the preview). */
  const handle = { kind: 'crossing', cornerId, key: testId } as const

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
    setGuides([])
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
    void store.copyTrackSizes(drag.layout, ['columns', 'rows'], { live: true })
    showResizePreview(null, handle)
    void store.endResize()
  })

  /**
   * The guide for an axis: along the line it snapped onto — another line,
   * or its own while the drag runs along the other axis (held in place) —
   * in the table as drawn (`drawn`: a structural axis's line is where the
   * corner cell now ends).
   */
  const guideOf = (drag: DragState, a: AxisDrag, other: AxisDrag, drawn: LayoutBody) => {
    const snapped = edgeSnap(drag.layout, lineOf(drag.layout, a), a.delta, a.opts)
    if (snapped == null) return null
    if (snapped === a.line && Math.abs(other.delta) <= EDGE_SNAP_PX) return null
    const line = a.structural ? (endLineOf(drawn, cornerId, a.axis) ?? snapped) : snapped
    return { axis: a.axis, line, tracks: drawn.grid[a.axis].length }
  }

  /**
   * One frame: both lines moved from the drag's start — the upright one,
   * then the level one on that result, as the release makes them. An axis
   * whose move only resizes is applied live; while either changes the
   * structure the table draws the result (`showResizePreview`), a
   * structural axis's sizes in the working copy back at the start, which
   * the release's move is computed from.
   */
  const frame = (dx: number, dy: number) => {
    const drag = dragRef.current
    if (!drag) return
    const ids = probeIds()
    const { columns, rows } = drag
    columns.delta = dx
    rows.delta = dy
    const afterColumns = moveEdge(drag.layout, lineOf(drag.layout, columns), dx, columns.opts, ids)
    columns.structural = afterColumns !== drag.layout && !layoutStructureEqual(afterColumns, drag.layout)
    const next = moveEdge(afterColumns, lineOf(afterColumns, rows), dy, rows.opts, ids)
    rows.structural = next !== afterColumns && !layoutStructureEqual(next, afterColumns)
    const store = useWorkspaceStore.getState()
    for (const a of [columns, rows]) void store.copyTrackSizes(a.structural ? drag.layout : next, [a.axis], { live: true })
    const structural = columns.structural || rows.structural
    showResizePreview(structural ? next : null, handle)
    const drawn = structural ? next : drag.layout
    setGuides([guideOf(drag, columns, rows, drawn), guideOf(drag, rows, columns, drawn)].filter((g) => g != null))
  }

  const flush = () => {
    rafRef.current = null
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending) frame(pending.dx, pending.dy)
  }

  /** The two axes' drag state from the table as drawn; `null` when it can't be measured. */
  const axesFrom = (layout: LayoutBody, table: HTMLElement): { columns: AxisDrag; rows: AxisDrag } | null => {
    const cols = drawnSizes(table, 'columns')
    const rows = drawnSizes(table, 'rows')
    if (cols.length !== layout.grid.columns.length || rows.length !== layout.grid.rows.length) return null
    const minPx = minPxIn(layout)
    const axis = (a: GridAxis, line: number, sizes: number[]): AxisDrag => ({
      axis: a,
      line,
      opts: { sizes, minPx, snapHome: true },
      delta: 0,
      structural: false,
    })
    return { columns: axis('columns', col, cols), rows: axis('rows', row, rows) }
  }

  const onPointerMove = (e: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    pendingRef.current = { dx: e.clientX - drag.x, dy: e.clientY - drag.y }
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
    // The live frames' sizes saved first (a structural axis put its sizes back to the start).
    void store.endResize()
    if (e.type === 'pointerup') {
      // A structural axis's move, made on the layout as it now stands (the other axis's lines are unchanged by it).
      // Both under the drag's merge key: one drag is one undo step.
      for (const a of [drag.columns, drag.rows]) {
        const working = useWorkspaceStore.getState().working
        if (a.structural && working) void store.moveEdge(lineOf(working, a), a.delta, a.opts, { mergeKey: drag.mergeKey })
      }
    }
    // In the same event: the move's table replaces the preview's in one render.
    showResizePreview(null, handle)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const layout = useWorkspaceStore.getState().working
    const table = e.currentTarget.closest<HTMLElement>('[data-ws-table]')
    if (!layout || !table) return
    const axes = axesFrom(layout, table)
    if (!axes) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    // The press's own time and count in the key: a later drag of this handle (or of one remounted in its place) is a step of its own.
    dragCountRef.current += 1
    const mergeKey = `crossing-drag:${testId}@${e.timeStamp}#${dragCountRef.current}`
    dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, layout, ...axes, mergeKey }
    pointer.listen(onPointerMove, onPointerUp)
    setDragging(true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowUp: ['rows', -1], ArrowDown: ['rows', 1], ArrowLeft: ['columns', -1], ArrowRight: ['columns', 1] } as const
    const move = step[e.key as keyof typeof step] as (typeof step)[keyof typeof step] | undefined
    if (!move) return
    e.preventDefault()
    const layout = useWorkspaceStore.getState().working
    const table = e.currentTarget.closest<HTMLElement>('[data-ws-table]')
    if (!layout || !table) return
    const [axis, sign] = move
    const sizes = drawnSizes(table, axis)
    if (sizes.length !== layout.grid[axis].length) return
    const line = axis === 'columns' ? col : row
    // Key steps on this handle are one undo step (when they move a line onto or past another), as a divider's.
    void useWorkspaceStore.getState().moveEdge(wholeLine(layout, axis, line), sign * KEY_STEP_PX, { sizes, minPx: minPxIn(layout) }, { mergeKey: `crossing:${testId}` })
  }

  /** Both lines' two tracks share their size evenly (weighted tracks only: a fixed or fit track keeps its height). */
  const onDoubleClick = () => {
    const layout = useWorkspaceStore.getState().working
    if (!layout) return
    const sizes: Record<string, number> = {}
    for (const [axis, line] of [['columns', col], ['rows', row]] as const) {
      const a = layout.grid[axis][line - 1]
      const b = layout.grid[axis][line]
      const weighted = [line - 1, line].every((t) => trackSizing(layout, axis, t).kind === 'weighted')
      if (!a || !b || !weighted) continue
      const half = ((a.weight ?? 0) + (b.weight ?? 0)) / 2
      sizes[a.id] = half
      sizes[b.id] = half
    }
    if (Object.keys(sizes).length > 0) void useWorkspaceStore.getState().setTrackSizes(sizes)
  }

  return (
    <>
      <div
        ref={elRef}
        className={`${styles.crossing} ${dragging ? styles.crossingDragging : ''}`}
        style={crossingPlacement(col, row)}
        role="separator"
        aria-roledescription="crossing handle"
        aria-label="Resize row and column"
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        tabIndex={0}
        data-ws-crossing={testId}
        data-col={col}
        data-row={row}
        // Its arrow keys move it; none of the app shortcuts (↑ / ↓ select tasks).
        {...shortcutScope('none')}
        onPointerDown={onPointerDown}
        onLostPointerCapture={(e) => recapture(e.currentTarget, e.pointerId, dragRef.current?.pointerId === e.pointerId)}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      />
      {/* The two whole lines it moves, lit by its hover, focus and drag (CSS: the siblings right after it). */}
      <div
        className={`${styles.crossingLine} ${styles.guideColumns}`}
        style={guidePlacement('columns', col)}
        aria-hidden="true"
        data-ws-crossing-line={testId}
        data-axis="columns"
      />
      <div
        className={`${styles.crossingLine} ${styles.guideRows}`}
        style={guidePlacement('rows', row)}
        aria-hidden="true"
        data-ws-crossing-line={testId}
        data-axis="rows"
      />
      {guides.map((g) => <SnapGuide key={g.axis} axis={g.axis} line={g.line} tracks={g.tracks} />)}
    </>
  )
}
