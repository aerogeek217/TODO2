import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { taskRowColumns, TASK_ROW } from '../../utils/task-row-columns'
import { TaskRowColumnsContext, UNMEASURED_LIST_WIDTH } from './task-row-grid-context'
import styles from './TaskRow.module.css'

/** One arrow-key step of the divider, px. */
const KEY_STEP = 8
/** The divider's hit area, px (centred on the gap left of the notes column). */
const HIT = 9

interface TaskRowGridProps {
  /** The stored details width (`undefined` = the default split). */
  detailsWidth?: number
  /**
   * Called with the new width when the divider is released (or stepped by
   * key), `undefined` on a double-click (back to the default). Without it
   * the list has no divider.
   */
  onDetailsWidthChange?: (width: number | undefined) => void
  /**
   * The width while a divider is dragged, shared by every list of one tab
   * (Eisenhower quadrants, dashboard sections) so they all follow the drag
   * live; `null` = no drag. Without `onLiveDetailsWidthChange` the list
   * keeps its own.
   */
  liveDetailsWidth?: number | null
  onLiveDetailsWidthChange?: (width: number | null) => void
  className?: string
  style?: CSSProperties
  children: ReactNode
}

/**
 * A list of `TaskRow`s sharing one set of columns: measures its own content
 * width (one ResizeObserver per list, not per row), lays the columns out from
 * it and the stored details width, and hands them to its rows. With
 * `onDetailsWidthChange` it draws the draggable divider between the titles
 * and the details, spanning the rows.
 */
export function TaskRowGrid({
  detailsWidth, onDetailsWidthChange, liveDetailsWidth, onLiveDetailsWidthChange, className, style, children,
}: TaskRowGridProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ width: number; padRight: number }>({ width: 0, padRight: 0 })
  /** The width while a divider is dragged (not stored yet): the tab's shared one, or this list's own. */
  const [ownLive, setOwnLive] = useState<number | null>(null)
  const live = onLiveDetailsWidthChange ? (liveDetailsWidth ?? null) : ownLive
  const setLive = onLiveDetailsWidthChange ?? setOwnLive
  /** This list's divider is the one being dragged. */
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; start: number; pointerId: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const cs = getComputedStyle(el)
      const padLeft = parseFloat(cs.paddingLeft) || 0
      const padRight = parseFloat(cs.paddingRight) || 0
      const width = Math.max(0, el.clientWidth - padLeft - padRight)
      setBox((prev) => (prev.width === width && prev.padRight === padRight ? prev : { width, padRight }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cols = useMemo(
    () => taskRowColumns(box.width > 0 ? box.width : UNMEASURED_LIST_WIDTH, live ?? detailsWidth),
    [box.width, live, detailsWidth],
  )

  const commit = (width: number | undefined) => {
    onDetailsWidthChange?.(width)
    setLive(null)
  }

  const divider = onDetailsWidthChange && (
    <div
      className={`${styles.divider} ${dragging ? styles.dividerDragging : ''}`}
      style={{ right: box.padRight + TASK_ROW.padRight + cols.laidOut + TASK_ROW.gap / 2 - HIT / 2 }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize task names and details"
      aria-valuenow={cols.details}
      aria-valuemin={cols.minDetails}
      aria-valuemax={cols.maxDetails}
      tabIndex={0}
      data-task-row-divider=""
      data-keeps-selection=""
      data-shortcut-scope="none"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, start: cols.details, pointerId: e.pointerId }
        setDragging(true)
        setLive(cols.details)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.pointerId !== e.pointerId) return
        const next = Math.round(Math.max(cols.minDetails, Math.min(cols.maxDetails, d.start - (e.clientX - d.x))))
        setLive(next)
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d || d.pointerId !== e.pointerId) return
        drag.current = null
        setDragging(false)
        const width = live ?? d.start
        if (width === d.start) setLive(null)
        else commit(width)
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
        setLive(null)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        commit(undefined)
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const step = { ArrowLeft: KEY_STEP, ArrowRight: -KEY_STEP }[e.key]
        let next: number | null = null
        if (step !== undefined) next = cols.details + step
        else if (e.key === 'Home') next = cols.minDetails
        else if (e.key === 'End') next = cols.maxDetails
        if (next === null) return
        e.preventDefault()
        e.stopPropagation()
        commit(Math.max(cols.minDetails, Math.min(cols.maxDetails, next)))
      }}
    >
      <span className={styles.dividerLine} />
    </div>
  )

  return (
    <TaskRowColumnsContext.Provider value={cols}>
      <div ref={ref} className={`${styles.grid} ${className ?? ''}`} style={style} data-task-row-grid="">
        {children}
        {divider}
      </div>
    </TaskRowColumnsContext.Provider>
  )
}
