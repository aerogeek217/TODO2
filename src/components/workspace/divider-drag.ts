import { useEffect, useRef, type CSSProperties } from 'react'
import type { GridAxis, LayoutBody } from '../../models/workspace-layout'
import type { MoveEdgeOptions } from '../../utils/workspace-layout-ops'
import { cellById, spanOf } from '../../utils/workspace-grid'
import { cellMinPx } from '../../utils/workspace-table'
import { useWorkspaceStore, type ResizeHandle } from '../../stores/workspace-store'
import { useLatestRef } from '../../hooks/use-latest-ref'

/**
 * What the table's resize handles share — a divider (`WorkspaceDivider`)
 * and a crossing handle (`WorkspaceCrossing`): the tracks as drawn, the
 * cells' minimums, throwaway ids for a preview's probe, the preview itself
 * and Esc.
 */

/** Keyboard step for a focused divider or crossing handle (px). */
export const KEY_STEP_PX = 16

/** The table's tracks along `axis` as drawn (px), from its computed grid template. */
export function drawnSizes(table: HTMLElement, axis: GridAxis): number[] {
  const style = getComputedStyle(table)
  const template = axis === 'columns' ? style.gridTemplateColumns : style.gridTemplateRows
  return template.split(' ').map((v) => Number.parseFloat(v)).filter((n) => Number.isFinite(n))
}

/** Each cell's minimum along an axis (`workspace-table.cellMinPx`: a collapsed cell's is its header). */
export function minPxIn(layout: LayoutBody): MoveEdgeOptions['minPx'] {
  return (cell, axis) => cellMinPx(layout, cell, axis)
}

/** Throwaway ids for a preview's probe (never stored). */
export function probeIds(): () => string {
  let n = 0
  return () => `probe-${++n}`
}

/** Where a snap guide (or a crossing's line) sits: in the gutter before the track after line `line`, across the whole table. */
export function guidePlacement(axis: GridAxis, line: number): CSSProperties {
  return axis === 'columns'
    ? { gridColumn: `${line + 1} / span 1`, gridRow: '1 / -1' }
    : { gridRow: `${line + 1} / span 1`, gridColumn: '1 / -1' }
}

/** The line cell `cellId` ends on along `axis` in `body` (its right / bottom edge); `null` when it isn't there. */
export function endLineOf(body: LayoutBody, cellId: string, axis: GridAxis): number | null {
  const cell = cellById(body, cellId)
  return cell ? spanOf(cell.area, axis)[1] : null
}

/**
 * Draws the table as `body` — the probe of a structural move, as the
 * release will leave it — while the drag of `handle` runs; `null` draws the
 * working copy again (`workspace-store.resizePreview`, transient).
 */
export function showResizePreview(body: LayoutBody | null, handle: ResizeHandle): void {
  const store = useWorkspaceStore.getState()
  const layoutId = store.working?.id
  store.setResizePreview(body && layoutId != null ? { layoutId, body, handle } : null)
}

/**
 * A handle's drag pointer, followed wherever it goes: `listen` (on the
 * press) hears its moves and its release or cancel on the window until
 * `unlisten` (or the handle unmounts). The handle's pointer capture alone
 * isn't enough: a structural preview can make React move the handle's
 * element among its siblings, which drops the capture (`recapture` takes it
 * back, for the cursor), and the release must never be missed.
 */
export function useDragPointer(): { listen: (onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent) => void) => void; unlisten: () => void } {
  const offRef = useRef<(() => void) | null>(null)
  useEffect(() => () => offRef.current?.(), [])
  const unlisten = () => offRef.current?.()
  const listen = (move: (e: PointerEvent) => void, end: (e: PointerEvent) => void) => {
    unlisten()
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
    offRef.current = () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
      offRef.current = null
    }
  }
  return { listen, unlisten }
}

/** Takes a dragging handle's pointer capture back after React moved its element (`lostpointercapture` while `dragging`). */
export function recapture(el: HTMLElement, pointerId: number, dragging: boolean): void {
  if (!dragging || !el.isConnected) return
  try {
    el.setPointerCapture?.(pointerId)
  } catch {
    // The pointer is up already: its release ends the drag.
  }
}

/**
 * While `active` (a handle's drag), Esc calls `onCancel` — the drag ends,
 * the table back as it was when it started — and goes no further.
 */
export function useEscapeCancel(active: boolean, onCancel: () => void): void {
  const cancelRef = useLatestRef(onCancel)
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancelRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, cancelRef])
}
