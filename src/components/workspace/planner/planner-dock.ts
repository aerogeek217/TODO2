import { useEffect, useMemo, useState } from 'react'
import { PLANNER_DOCK_SHARE_MAX, PLANNER_DOCK_SHARE_MIN } from '../../../models/workspace-layout'

/*
 * The portrait Planner's trays dock (board R1): the share's bounds, and the
 * days in view for the strip's line (`PlannerDock`, `PlannerStrip`).
 */

/** The dock's grip strip, px: its top edge, where the share is dragged. */
const DOCK_GRIP_PX = 14
/** The least the dock keeps, px: its grip, a heading and a row. */
const DOCK_MIN_PX = DOCK_GRIP_PX + 30 + 44
/** The least the day list keeps, px: Today's heading and a row. */
const DAYS_MIN_PX = 30 + 44
/** One arrow key's step, px (the workspace dividers'). */
export const KEY_STEP_PX = 16

/** `share` kept within the stored bounds and each side's minimum, for a stack `height` px tall. */
export function clampDockShare(share: number, height: number): number {
  const lo = Math.max(PLANNER_DOCK_SHARE_MIN, height > 0 ? DOCK_MIN_PX / height : 0)
  const hi = Math.min(PLANNER_DOCK_SHARE_MAX, height > 0 ? 1 - DAYS_MIN_PX / height : 1)
  return Math.min(Math.max(share, lo), Math.max(lo, hi))
}

/** Today's and the days' groups in a day list (their `data-planner-group` is their `dayKey`). */
const DAY_GROUPS = '[data-planner-group-kind="today"], [data-planner-group-kind="day"]'

/**
 * The days whose groups show (partly) in the scroller `pane` — their
 * `dayKey`s —, kept as it scrolls and as its rows change size (one read a
 * frame). Empty while `pane` is null (a key read before it went is ignored).
 */
export function useDaysInView(pane: HTMLElement | null): ReadonlySet<string> {
  const [keys, setKeys] = useState('')
  useEffect(() => {
    if (!pane) return undefined
    let frame = 0
    const read = () => {
      frame = 0
      const box = pane.getBoundingClientRect()
      const shown = Array.from(pane.querySelectorAll<HTMLElement>(DAY_GROUPS)).filter((el) => {
        const r = el.getBoundingClientRect()
        return r.bottom > box.top + 1 && r.top < box.bottom - 1
      }).map((el) => el.getAttribute('data-planner-group') ?? '')
      setKeys(shown.join(' '))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read) }
    schedule()
    pane.addEventListener('scroll', schedule, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    observer?.observe(pane)
    if (pane.firstElementChild) observer?.observe(pane.firstElementChild)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      pane.removeEventListener('scroll', schedule)
      observer?.disconnect()
    }
  }, [pane])
  return useMemo(() => new Set(pane && keys ? keys.split(' ') : []), [pane, keys])
}
