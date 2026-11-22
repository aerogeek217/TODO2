import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { PLANNER_DOCK_SHARE, PLANNER_DOCK_SHARE_MAX, PLANNER_DOCK_SHARE_MIN } from '../../../models/workspace-layout'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { PLANNER_UNPLANNED_KEY, type PlannerSpan } from '../../../utils/planner'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { plannerDropId, TASK_DROP_KIND, type PlannerDropData } from '../../../utils/task-dnd'
import { ChevronDownIcon, ChevronUpIcon } from '../../shared/icons'
import { useEscapeCancel } from '../divider-drag'
import { clampDockShare, KEY_STEP_PX } from './planner-dock'
import styles from './PlannerWidget.module.css'

/** A share as stored: three decimals. */
const stored = (share: number): number => Math.round(share * 1000) / 1000

/** How far a press on the grip moves before it is a drag, px. */
const DRAG_THRESHOLD_PX = 3

interface PlannerDockProps {
  tabId: string
  /** The stored share (`PlannerTabViewState.dockShare`); absent, the default. */
  share: number | undefined
  /** The column the days and the dock share: measured for a drag's share. */
  stackRef: RefObject<HTMLElement | null>
  /** The trays' rows (Delayed, the Unplan button, Unplanned). */
  children: ReactNode
}

/**
 * The trays dock of a portrait Planner (board R1): Delayed, the Unplan
 * button and Unplanned on the darker ground under the days, in a scroll of
 * their own (`data-planner-pane="trays"`, so a drag measures and scrolls it
 * as the large face's right pane). Its top edge is a **separator**: a drag
 * shares the height between the days and the dock (live, saved once at the
 * drag's end — the tab's `dockShare`, view state, no undo step; Esc puts it
 * back), the arrow keys step it 16px (each step saved), a double-click
 * clears the share back to the default. The chevron at its right folds the
 * dock (`dockFolded`) to `PlannerFoldedDock`.
 */
export function PlannerDock({ tabId, share, stackRef, children }: PlannerDockProps) {
  const [live, setLive] = useState<number | null>(null)
  /** A press on the grip: where it started, the share drawn then, and whether it has moved past the threshold. */
  const dragRef = useRef<{ pointerId: number; startY: number; startShare: number; moved: boolean } | null>(null)
  const drawn = live ?? share ?? PLANNER_DOCK_SHARE
  const save = (next: number | undefined) => { void useWorkspaceStore.getState().patchTabViewState(tabId, 'planner', { dockShare: next }) }
  const height = () => stackRef.current?.clientHeight ?? 0
  /** The share the press gives at `clientY`: the start's, moved by how far the pointer went (so the dock never jumps under it). */
  const fromPointer = (drag: { startY: number; startShare: number }, clientY: number): number => {
    const h = height()
    return h > 0 ? clampDockShare(drag.startShare + (drag.startY - clientY) / h, h) : drag.startShare
  }
  const cancel = () => {
    dragRef.current = null
    setLive(null)
  }
  // Esc puts the dock back wherever the focus is (the divider's way): only while a drag moves it.
  useEscapeCancel(live != null, cancel)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    // preventDefault keeps the browser from focusing it: the grip takes the focus itself, so the arrow keys follow on.
    e.currentTarget.focus({ preventScroll: true })
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startShare: drawn, moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag?.pointerId !== e.pointerId) return
    if (!drag.moved && Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return
    drag.moved = true
    setLive(fromPointer(drag, e.clientY))
  }
  const finish = (e: ReactPointerEvent<HTMLDivElement>, keep: boolean) => {
    const drag = dragRef.current
    if (drag?.pointerId !== e.pointerId) return
    dragRef.current = null
    setLive(null)
    // A press that never moved (a click, half a double-click) saves nothing.
    if (!keep || !drag.moved) return
    const next = stored(fromPointer(drag, e.clientY))
    if (next !== stored(drag.startShare)) save(next)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const h = height()
    if (h <= 0) return
    save(stored(clampDockShare(drawn + (step * KEY_STEP_PX) / h, h)))
  }

  const percent = Math.round(drawn * 100)
  return (
    <div className={styles.dock} style={{ height: `${drawn * 100}%` }} data-planner-dock="" data-resizing={live != null ? '' : undefined}>
      <div
        className={styles.dockGrip}
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label="Resize the trays"
        aria-valuemin={Math.round(PLANNER_DOCK_SHARE_MIN * 100)}
        aria-valuemax={Math.round(PLANNER_DOCK_SHARE_MAX * 100)}
        aria-valuenow={percent}
        data-tooltip="Drag to resize · double-click to reset"
        data-planner-dock-grip=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, true)}
        onPointerCancel={(e) => finish(e, false)}
        onLostPointerCapture={(e) => finish(e, true)}
        onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) save(undefined) }}
        onKeyDown={onKeyDown}
      >
        <span className={styles.dockHandle} aria-hidden="true" />
        <button
          type="button"
          className={styles.dockFold}
          aria-label="Fold the trays"
          aria-expanded="true"
          data-tooltip="Fold the trays"
          onClick={() => { void useWorkspaceStore.getState().patchTabViewState(tabId, 'planner', { dockFolded: true }) }}
        >
          <ChevronDownIcon size={12} />
        </button>
      </div>
      <div ref={trackScrollEdges} className={`${styles.pane} ${styles.traysPane} ${styles.dockPane}`} data-planner-pane="trays">
        {children}
      </div>
    </div>
  )
}

/**
 * The trays dock folded (`dockFolded`): one bar — `Delayed 2 · Unplanned 6`
 * (Delayed left out while empty) and an up chevron —, a click unfolding it;
 * where the bar is wide enough, Unplanned's filter line (`filter`) sits over
 * its end, before the chevron, its own button.
 * It is a drop target that means **Unplanned** (a dnd-kit droppable, its
 * data a tile's with the Unplanned target, so a drop keeps the hand order
 * and the drop rule is the tray's: `utils/planner.plannerDrop`); dashed
 * while a dragged task's drop there changes its plan (`marked`).
 */
export function PlannerFoldedDock({ tabId, window, delayed, unplanned, marked, filter }: {
  tabId: string
  window: PlannerSpan
  delayed: number
  unplanned: number
  marked: boolean
  /** Unplanned's filter line (`PlannerFilterLine`). */
  filter?: ReactNode
}) {
  const data: PlannerDropData = { type: TASK_DROP_KIND.plannerDay, scope: tabId, target: { kind: 'unplanned' }, window }
  const { setNodeRef } = useDroppable({ id: plannerDropId(tabId, 'tile', `${PLANNER_UNPLANNED_KEY}-bar`), data: { ...data } })
  const label = [delayed > 0 ? `Delayed ${delayed}` : null, `Unplanned ${unplanned}`].filter(Boolean).join(', ')
  return (
    <div className={styles.dockBarHost} data-planner-dock-bar-anchor={tabId}>
      <button
        ref={setNodeRef}
        type="button"
        className={styles.dockBar}
        aria-label={`Show the trays: ${label}`}
        aria-expanded="false"
        data-tooltip="Show the trays"
        data-planner-dock-bar=""
        data-planner-drop={marked ? '' : undefined}
        onClick={() => { void useWorkspaceStore.getState().patchTabViewState(tabId, 'planner', { dockFolded: undefined }) }}
      >
        {delayed > 0 && (
          <>
            <span className={styles.dockBarName}>Delayed</span>
            <span className={styles.dockBarCount}>{delayed}</span>
            <span className={styles.dockBarDot} aria-hidden="true">·</span>
          </>
        )}
        <span className={styles.dockBarName}>Unplanned</span>
        <span className={styles.dockBarCount}>{unplanned}</span>
        <span className={styles.topLineGap} aria-hidden="true" />
        <ChevronUpIcon size={12} />
      </button>
      {filter && <div className={styles.dockBarFilter}>{filter}</div>}
    </div>
  )
}
