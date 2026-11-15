import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { ALL_ROW_FIELDS, sameRowFields, taskRowColumns, TASK_ROW, type RowFieldsUsed } from '../../utils/task-row-columns'
import type { ListZoom } from '../../models/workspace-layout'
import { createValueStore, type ValueStore } from '../../utils/value-store'
import { TaskRowColumnsContext, UNMEASURED_LIST_WIDTH } from './task-row-grid-context'
import styles from './TaskRow.module.css'
import { KEEPS_SELECTION_ATTR, shortcutScope } from '../../utils/dom-contract'
import { trackHot } from '../../utils/hot-attr'

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
   * The width while a divider is dragged (`null` = no drag), shared by every
   * list of one tab (a glance widget's groups) so they all
   * follow the drag live. Without it the list keeps its own.
   */
  liveDetailsWidth?: ValueStore<number | null>
  /**
   * How the rows are drawn (`data-zoom`; a list tab's zoom, D25 C + I1);
   * default `rows`. The divider shows at `rows` only: the other levels have
   * no details columns.
   */
  zoom?: ListZoom
  /**
   * The fields the list's shown rows use (flair P8): an unused one gets no
   * column (its rows show it on hover). Without it every column is there.
   */
  used?: RowFieldsUsed
  className?: string
  style?: CSSProperties
  children: ReactNode
}

/**
 * A list of `TaskRow`s sharing one set of columns: measures its own content
 * width (one ResizeObserver per list, not per row), lays the columns out from
 * it and the stored details width, and hands them to its rows as a store:
 * each row writes the tracks to its own style and reads only the parts it
 * shows (`useTaskRowTracks` / `useTaskRowColumn`). So a divider drag
 * re-renders the grid, and a row only when a column appears or goes or its
 * avatars / tags no longer fit the same way (a dates tier change re-renders
 * only the dates cells); the rest is layout. With
 * `onDetailsWidthChange` it draws the draggable divider between the titles
 * and the details, spanning the rows; the width is written on release only.
 * Carries the rows' zoom (`data-zoom`): only a list tab picks one; every
 * other list of rows is at `rows`.
 */
export function TaskRowGrid({
  detailsWidth, onDetailsWidthChange, liveDetailsWidth, zoom = 'rows', used, className, style, children,
}: TaskRowGridProps) {
  const ref = useRef<HTMLDivElement>(null)
  const fields = useShownFields(ref, used ?? ALL_ROW_FIELDS)
  const [box, setBox] = useState<{ width: number; padRight: number }>({ width: 0, padRight: 0 })
  /** The width while a divider is dragged (not stored yet): the tab's shared one, or this list's own. */
  const [ownLive] = useState(() => createValueStore<number | null>(null))
  const liveStore = liveDetailsWidth ?? ownLive
  const live = useSyncExternalStore(liveStore.subscribe, liveStore.get)
  const setLive = liveStore.set
  /** This list's divider is the one being dragged. */
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; start: number; pointerId: number } | null>(null)
  // Unmounted mid-drag (the tab closed, the layout switched): let go of the
  // live width, which the tab's other lists may be showing.
  useEffect(() => {
    const dragRef = drag
    return () => { if (dragRef.current) liveStore.set(null) }
  }, [liveStore])

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
    () => taskRowColumns(box.width > 0 ? box.width : UNMEASURED_LIST_WIDTH, live ?? detailsWidth, fields),
    [box.width, live, detailsWidth, fields],
  )
  /** The columns for the rows: published after each change (they re-render where what they show changed). */
  const [columns] = useState(() => createValueStore(cols))
  useLayoutEffect(() => { columns.set(cols) }, [columns, cols])
  // `data-rows-hover` while the pointer is over the list: the divider's faint line shows by it (`utils/hot-attr`).
  useLayoutEffect(() => trackHot(ref.current, 'data-rows-hover', { hover: true }), [])

  const commit = (width: number | undefined) => {
    onDetailsWidthChange?.(width)
    setLive(null)
  }

  // No details columns at all (the list uses none of the fields): nothing to resize.
  const divider = onDetailsWidthChange && zoom === 'rows' && cols.laidOut > 0 && (
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
      {...{ [KEEPS_SELECTION_ATTR]: '' }}
      {...shortcutScope('none')}
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
        const width = liveStore.get() ?? d.start
        if (width === d.start) setLive(null)
        else commit(width)
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
        setLive(null)
      }}
      // Capture lost without a pointerup (after one, `drag` is already cleared).
      onLostPointerCapture={() => {
        if (!drag.current) return
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
    <TaskRowColumnsContext.Provider value={columns}>
      <div ref={ref} className={`${styles.grid} ${className ?? ''}`} style={style} data-task-row-grid="" data-zoom={zoom}>
        {children}
        {divider}
      </div>
    </TaskRowColumnsContext.Provider>
  )
}

/** Every field either set uses. */
function unionFields(a: RowFieldsUsed, b: RowFieldsUsed): RowFieldsUsed {
  return {
    notes: a.notes || b.notes, people: a.people || b.people, tags: a.tags || b.tags,
    due: a.due || b.due, followup: a.followup || b.followup, status: a.status || b.status,
  }
}

/** The list is in use: the pointer over it, the focus in it, or one of its rows' pickers open. */
function listBusy(el: HTMLElement): boolean {
  return el.matches(':hover') || el.contains(document.activeElement) || el.querySelector('[aria-expanded="true"]') !== null
}

/**
 * The fields the columns are laid out for: a field the rows start using
 * gets its column at once; one they stop using keeps it until the list is
 * no longer in use (`listBusy`), so a column never leaves under the pointer
 * or from beneath an open picker — the titles re-flow once, after.
 */
function useShownFields(ref: RefObject<HTMLDivElement | null>, wanted: RowFieldsUsed): RowFieldsUsed {
  const [shown, setShown] = useState(wanted)
  const grown = unionFields(shown, wanted)
  // A field to add: now, during render.
  if (!sameRowFields(grown, shown)) setShown(grown)
  const dropPending = sameRowFields(grown, shown) && !sameRowFields(shown, wanted)
  useEffect(() => {
    const el = ref.current
    if (!dropPending || !el) return
    let frame = 0
    const settle = () => {
      cancelAnimationFrame(frame)
      // After a focusout the focus has not moved yet: look on the next frame.
      frame = requestAnimationFrame(() => { if (!listBusy(el)) setShown(wanted) })
    }
    if (!listBusy(el)) {
      setShown(wanted)
      return
    }
    el.addEventListener('pointerleave', settle)
    el.addEventListener('focusout', settle)
    // A picker closing (its cell's aria-expanded) while the pointer is elsewhere.
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(settle)
    mo?.observe(el, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('pointerleave', settle)
      el.removeEventListener('focusout', settle)
      mo?.disconnect()
    }
  }, [ref, dropPending, wanted])
  return shown
}
