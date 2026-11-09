import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { GridAxis, LayoutBody } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { wholeLine } from '../../utils/workspace-grid'
import { EDGE_SNAP_PX, edgeSnap, moveEdge, type MoveEdgeOptions } from '../../utils/workspace-layout-ops'
import { layoutStructureEqual } from '../../utils/workspace-layout-queries'
import { trackSizing } from '../../utils/workspace-table'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { shortcutScope } from '../../utils/dom-contract'
import { measureTableElement } from './measure'
import { drawnSizes, KEY_STEP_PX, minPxIn, previewOffset, probeIds, type PreviewBasis } from './divider-drag'
import { SnapGuide } from './WorkspaceDivider'
import styles from './WorkspaceDivider.module.css'

interface WorkspaceCrossingProps {
  /** The column line and the row line crossing here (`workspace-grid.lineCrossings`). */
  col: number
  row: number
  /** The cell above-left of the crossing: it ends on both lines (the preview of a structural move reads them off it). */
  cornerId: string
  /** Its `data-ws-crossing`: the cells above-left and below-right, `<a>|<b>`. */
  testId: string
}

/** One axis of a crossing drag: the whole line it moves and where it stands. */
interface AxisDrag {
  axis: GridAxis
  line: number
  opts: MoveEdgeOptions
  basis: PreviewBasis
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
 * meet, a small handle that moves both whole lines through it at once — the
 * level line with the pointer's y, the upright one with its x. Each is a
 * whole-line move (`moveEdge` over `wholeLine`): its two tracks share their
 * size anew, live, saved once at the drag's end as view state; each snaps
 * back onto its own place within 8px (`snapHome`), so a mostly vertical
 * drag leaves the upright line where it was, and onto any other line of its
 * axis within reach (a structural edit, previewed, made on release). A
 * faint guide runs along a line while it holds. ↑/↓ move the level line,
 * ←/→ the upright one, 16px; a double-click evens both lines' tracks.
 */
export function WorkspaceCrossing({ col, row, cornerId, testId }: WorkspaceCrossingProps) {
  const dragRef = useRef<DragState | null>(null)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<{ dx: number; dy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null)
  const [guides, setGuides] = useState<{ axis: GridAxis; line: number; tracks: number }[]>([])

  // Gone mid-drag: what the frames applied is kept all the same.
  const endRef = useLatestRef(() => { void useWorkspaceStore.getState().endResize() })
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    if (dragRef.current) endRef.current()
  }, [endRef])

  /** One axis of a frame: its line moved live, or (structural) previewed with the sizes back at the start. Returns its preview offset. */
  const frameAxis = (drag: DragState, a: AxisDrag, delta: number): number => {
    a.delta = delta
    const next = moveEdge(drag.layout, lineOf(drag.layout, a), delta, a.opts, probeIds())
    a.structural = next !== drag.layout && !layoutStructureEqual(next, drag.layout)
    void useWorkspaceStore.getState().copyTrackSizes(a.structural ? drag.layout : next, [a.axis], { live: true })
    return a.structural ? previewOffset(a.basis, a.axis, a.line, next, cornerId, delta) : 0
  }

  /**
   * The guide for an axis: along the line it snapped onto — another line,
   * or its own while the drag runs along the other axis (held in place).
   */
  const guideOf = (drag: DragState, a: AxisDrag, other: AxisDrag) => {
    const snapped = edgeSnap(drag.layout, lineOf(drag.layout, a), a.delta, a.opts)
    if (snapped == null) return null
    if (snapped === a.line && Math.abs(other.delta) <= EDGE_SNAP_PX) return null
    return { axis: a.axis, line: snapped, tracks: drag.layout.grid[a.axis].length }
  }

  const frame = (dx: number, dy: number) => {
    const drag = dragRef.current
    if (!drag) return
    const x = frameAxis(drag, drag.columns, dx)
    const y = frameAxis(drag, drag.rows, dy)
    setPreview(x !== 0 || y !== 0 ? { x, y } : null)
    setGuides([guideOf(drag, drag.columns, drag.rows), guideOf(drag, drag.rows, drag.columns)].filter((g) => g != null))
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
    const metrics = measureTableElement(table)
    const rowPx = new Map(Object.entries(metrics.rowPx))
    const minPx = minPxIn(layout)
    const axis = (a: GridAxis, line: number, sizes: number[], available: number): AxisDrag => ({
      axis: a,
      line,
      opts: { sizes, minPx, snapHome: true },
      basis: { available, gap: metrics.gap, rowPx, sizes },
      delta: 0,
      structural: false,
    })
    return { columns: axis('columns', col, cols, metrics.width), rows: axis('rows', row, rows, metrics.height) }
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
    dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, layout, ...axes }
    setDragging(true)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    pendingRef.current = { dx: e.clientX - drag.x, dy: e.clientY - drag.y }
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
    setGuides([])
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const store = useWorkspaceStore.getState()
    // The live frames' sizes saved first (a structural axis put its sizes back to the start).
    void store.endResize()
    if (e.type !== 'pointerup') return
    // A structural axis's move, made on the layout as it now stands (the other axis's lines are unchanged by it).
    for (const a of [drag.columns, drag.rows]) {
      const working = useWorkspaceStore.getState().working
      if (a.structural && working) void store.moveEdge(lineOf(working, a), a.delta, a.opts)
    }
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
    void useWorkspaceStore.getState().moveEdge(wholeLine(layout, axis, line), sign * KEY_STEP_PX, { sizes, minPx: minPxIn(layout) })
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

  const shift = preview ? `translate(${preview.x}px, ${preview.y}px)` : undefined
  return (
    <>
      <div
        className={`${styles.crossing} ${dragging ? styles.crossingDragging : ''}`}
        style={{ ...crossingPlacement(col, row), ...(shift ? { transform: shift } : {}) }}
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
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      />
      {guides.map((g) => <SnapGuide key={g.axis} axis={g.axis} line={g.line} tracks={g.tracks} />)}
    </>
  )
}
