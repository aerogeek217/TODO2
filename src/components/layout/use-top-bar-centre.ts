import { useLayoutEffect, useState, type RefObject } from 'react'
import { attrSelector, FILTER_MENU_ATTR } from '../../utils/dom-contract'
import { FOLD_SEARCH_ATTR, SEARCH_WIDTH } from './use-top-bar-fold'

/** What `centreOffset` decides from: viewport px, read with the centring gap at `offset`. */
export interface CentreMeasure {
  /** The bar's left edge and width. */
  barLeft: number
  barWidth: number
  /** Where the tray starts with no centring gap: as far left as it may go. */
  start: number
  /** The tray at rest — the funnel, the field at its full width and the Filter button, no counter. */
  restWidth: number
  /** The tray as it is now (its counter included). */
  groupWidth: number
  /** The right zone's left edge (its padding is the least gap before it). */
  rightLeft: number
}

/**
 * The centring gap before the top bar's filter tray: the tray at rest
 * centred in the bar; a tray grown by the counter keeps its left
 * edge (the field never moves under the user) and runs on rightwards,
 * moving left only once it would reach the right zone;
 * never left of `start` (the tabs' least gap — past that the fold takes over).
 * Whole px, never negative.
 */
export function centreOffset(m: CentreMeasure): number {
  const centred = m.barLeft + (m.barWidth - m.restWidth) / 2
  const left = Math.max(m.start, Math.min(centred, m.rightLeft - m.groupWidth))
  return Math.max(0, Math.round(left - m.start))
}

/**
 * The tray's width at rest: from its left to the Filter button's right (the
 * last part but the counter) and its padding — the field as wide as it is
 * drawn (narrowed, the tray at rest is that much narrower).
 */
function restTrayWidth(tray: HTMLElement, trayBox: DOMRect): number {
  const cs = getComputedStyle(tray)
  const padding = parseFloat(cs.paddingRight) || 0
  const button = tray.querySelector<HTMLElement>(attrSelector(FILTER_MENU_ATTR))
  if (button) return button.getBoundingClientRect().right - trayBox.left + padding
  const field = tray.querySelector<HTMLElement>(attrSelector(FOLD_SEARCH_ATTR))
  return (field?.getBoundingClientRect().left ?? trayBox.left) - trayBox.left + SEARCH_WIDTH + padding
}

/**
 * The centring gap for the top bar's filter tray, measured (`centreOffset`)
 * after each resize of the bar or a part of it, on the next frame. `tray` =
 * the tray, `right` the right zone, `spacer` the gap's element (its laid-out
 * width is taken out of the measure, so the result doesn't depend on it).
 */
export function useTopBarCentre(
  barRef: RefObject<HTMLElement | null>,
  spacerRef: RefObject<HTMLElement | null>,
  trayRef: RefObject<HTMLElement | null>,
  rightRef: RefObject<HTMLElement | null>,
): number {
  const [offset, setOffset] = useState(0)
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const measure = () => {
      frame = 0
      const tray = trayRef.current
      const right = rightRef.current
      if (!tray || !right) return
      const barBox = bar.getBoundingClientRect()
      const trayBox = tray.getBoundingClientRect()
      // The gap as laid out (flex may have shrunk it below what was set).
      const laidOut = spacerRef.current?.getBoundingClientRect().width ?? 0
      setOffset((shown) => {
        const start = trayBox.left - laidOut
        const restWidth = restTrayWidth(tray, trayBox)
        const next = centreOffset({
          barLeft: barBox.left,
          barWidth: barBox.width,
          start,
          restWidth,
          groupWidth: trayBox.width,
          rightLeft: right.getBoundingClientRect().left,
        })
        return Math.abs(next - shown) <= 0.5 ? shown : next
      })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(bar)
    for (const el of [trayRef.current, rightRef.current]) if (el) observer.observe(el)
    // The tray's parts too: a part that shrinks keeps its box while its content changes.
    for (const child of Array.from(trayRef.current?.children ?? [])) observer.observe(child)
    schedule()
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  })
  return offset
}
