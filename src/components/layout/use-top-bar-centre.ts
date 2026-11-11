import { useLayoutEffect, useState, type RefObject } from 'react'
import { attrSelector } from '../../utils/dom-contract'
import { FOLD_HIDDEN_ATTR, FOLD_VARIANT_ATTR } from '../shared/filters/FilterChipBar.shared'
import { FOLD_SEARCH_ATTR, SEARCH_WIDTH } from './use-top-bar-fold'

/** What `centreOffset` decides from: viewport px, read with the centring gap at `offset`. */
export interface CentreMeasure {
  /** The bar's left edge and width. */
  barLeft: number
  barWidth: number
  /** Where the group (the lens control, else the tray) starts with no centring gap: as far left as it may go. */
  start: number
  /** The group at rest — the lens control, the field at its full width and the Filter button, no chip, no counter. */
  restWidth: number
  /** The group as it is now (its chips and counter included). */
  groupWidth: number
  /** The right zone's left edge (its padding is the least gap before it). */
  rightLeft: number
}

/**
 * The centring gap before the top bar's lens-and-filter group: the group at
 * rest centred in the bar; a group grown by chips or the counter keeps its
 * left edge (the lens control and the field never move under the user) and
 * runs on rightwards, moving left only once it would reach the right zone;
 * never left of `start` (the tabs' least gap — past that the fold takes over).
 * Whole px, never negative.
 */
export function centreOffset(m: CentreMeasure): number {
  const centred = m.barLeft + (m.barWidth - m.restWidth) / 2
  const left = Math.max(m.start, Math.min(centred, m.rightLeft - m.groupWidth))
  return Math.max(0, Math.round(left - m.start))
}

/** The Filter button's width without a count badge: the first button of the hidden unfolded copy. */
function restButtonWidth(tray: HTMLElement): number {
  const button = tray.querySelector<HTMLElement>(`${attrSelector(FOLD_VARIANT_ATTR, 'open')}${attrSelector(FOLD_HIDDEN_ATTR)} > button`)
  return button?.getBoundingClientRect().width ?? 0
}

/**
 * The centring gap for the top bar's middle group, measured (`centreOffset`)
 * after each resize of the bar or a part of it, on the next frame. `group` =
 * the group's first part (the lens control slot, else the tray), `tray` the
 * tray, `right` the right zone, `spacer` the gap's element (its laid-out
 * width is taken out of the measure, so the result doesn't depend on it).
 */
export function useTopBarCentre(
  barRef: RefObject<HTMLElement | null>,
  spacerRef: RefObject<HTMLElement | null>,
  groupRef: RefObject<HTMLElement | null>,
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
      const group = groupRef.current
      const tray = trayRef.current
      const right = rightRef.current
      if (!group || !tray || !right) return
      const barBox = bar.getBoundingClientRect()
      const groupBox = group.getBoundingClientRect()
      const trayBox = tray.getBoundingClientRect()
      const field = tray.querySelector<HTMLElement>(attrSelector(FOLD_SEARCH_ATTR))
      const trayCs = getComputedStyle(tray)
      const gap = parseFloat(trayCs.columnGap) || 0
      const fieldLeft = field?.getBoundingClientRect().left ?? trayBox.left
      // The gap as laid out (flex may have shrunk it below what was set).
      const laidOut = spacerRef.current?.getBoundingClientRect().width ?? 0
      setOffset((shown) => {
        const start = groupBox.left - laidOut
        const restWidth = (fieldLeft - groupBox.left) + SEARCH_WIDTH + gap + restButtonWidth(tray) + (parseFloat(trayCs.paddingRight) || 0)
        const next = centreOffset({
          barLeft: barBox.left,
          barWidth: barBox.width,
          start,
          restWidth,
          groupWidth: trayBox.right - groupBox.left,
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
    for (const el of [groupRef.current, trayRef.current, rightRef.current]) if (el) observer.observe(el)
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
