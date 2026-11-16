import { useLayoutEffect, useState, type RefObject } from 'react'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { attrSelector } from '../../utils/dom-contract'

/**
 * What of the top bar is folded so that it never wraps or overflows:
 * `none`; `tabs` = the layout tabs into the layout picker. Before they
 * fold, the filter field narrows (`SEARCH_WIDTH` → `SEARCH_MIN_WIDTH`; its
 * pills fade with `+N more`); once they have folded it may narrow further,
 * to `SEARCH_FOLDED_MIN_WIDTH`. The filters themselves never fold: they are
 * the field's pills (feedback P2).
 */
type TopBarFold = 'none' | 'tabs'

/** Whether the layout tabs show as the layout picker. */
export function tabsFolded(fold: TopBarFold): boolean {
  return fold === 'tabs'
}

/** The filter field's width (board Filter-B had 560px; narrowed to 440px, feedback 2026-11-15). */
export const SEARCH_WIDTH = 440
/** The least it narrows to before the layout tabs fold: two or three pills still show. */
export const SEARCH_MIN_WIDTH = 240
/** The least it narrows to once they have folded (its placeholder's start and a pill still show). */
export const SEARCH_FOLDED_MIN_WIDTH = 160

/** What `topBarFold` decides from: widths measured in the bar, px. */
export interface TopBarMeasure {
  /** The bar's width. */
  bar: number
  /** What every fold needs besides the filter tray and the layout controls (padding, gaps, the right zone with New task). */
  base: number
  /** The tray with the field at `SEARCH_WIDTH`. */
  tray?: number
  /** The layout tabs, when last shown, with what they showed then (`tabsKey`). */
  tabs?: { width: number; key: string }
  /** The layout picker (the tabs folded), when last shown. */
  picker?: number
}

/** The tray with the field at `width` instead of `SEARCH_WIDTH`. */
function trayAt(m: TopBarMeasure, width: number): number {
  return (m.tray ?? 0) - (SEARCH_WIDTH - width)
}

/**
 * The least fold whose parts fit the bar, the field narrowed to
 * `SEARCH_MIN_WIDTH`. Tabs not measured yet (or showing other layouts since)
 * count as fitting — they are shown, measured, and folded again on the next
 * frame when they don't fit.
 */
export function topBarFold(m: TopBarMeasure, tabsKey: string): TopBarFold {
  if (m.bar <= 0 || m.tray === undefined) return 'none'
  const tabs = m.tabs?.key === tabsKey ? m.tabs.width : 0
  return m.base + trayAt(m, SEARCH_MIN_WIDTH) + tabs <= m.bar ? 'none' : 'tabs'
}

/**
 * The field's width at `fold`: `SEARCH_WIDTH` where the tray fits, else as
 * wide as the room the bar leaves it, down to the fold's least.
 */
export function searchWidth(m: TopBarMeasure, fold: TopBarFold): number {
  if (m.bar <= 0 || m.tray === undefined) return SEARCH_WIDTH
  const layout = (tabsFolded(fold) ? m.picker : m.tabs?.width) ?? 0
  const room = m.bar - m.base - layout
  const over = Math.ceil(m.tray - room)
  if (over <= 0) return SEARCH_WIDTH
  return Math.max(tabsFolded(fold) ? SEARCH_FOLDED_MIN_WIDTH : SEARCH_MIN_WIDTH, SEARCH_WIDTH - over)
}

/**
 * The bar's parts, by their `data-fold-part`: the filter tray, the layout
 * controls, the right zone (its auto margin is free space) and the centring
 * gap before the tray (`useTopBarCentre`: free space too — only its place,
 * the bar's gap, counts).
 */
export const FOLD_PART = { tray: 'tray', layout: 'layout', spring: 'spring', centre: 'centre' } as const

/** On the tray's filter field (`SEARCH_WIDTH` wide, narrowed by `searchWidth`). */
export const FOLD_SEARCH_ATTR = 'data-fold-search'

/**
 * The tray's width as its content needs it: the tray may be squeezed (its
 * box narrower, its fixed-width parts running past its edge — `scrollWidth`
 * misses a few px of that), so its padding plus the span of what is laid
 * out in it, margins included (a `display: contents` wrapper's children).
 */
function trayContentWidth(tray: HTMLElement): number {
  let left = Infinity
  let right = -Infinity
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue
      const cs = getComputedStyle(child)
      if (cs.display === 'contents') { visit(child); continue }
      if (cs.display === 'none' || cs.position === 'fixed' || cs.position === 'absolute') continue
      // With its margins: the box the tray lays out for it.
      const r = child.getBoundingClientRect()
      left = Math.min(left, r.left - (parseFloat(cs.marginLeft) || 0))
      right = Math.max(right, r.right + (parseFloat(cs.marginRight) || 0))
    }
  }
  visit(tray)
  const cs = getComputedStyle(tray)
  const padding = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  return right > left ? Math.max(tray.offsetWidth, right - left + padding) : tray.offsetWidth
}

/** The tray's width with its field at `SEARCH_WIDTH`, whatever it is narrowed to now. */
function measureTray(tray: HTMLElement): number {
  const search = tray.querySelector<HTMLElement>(attrSelector(FOLD_SEARCH_ATTR))
  const searchGain = search ? SEARCH_WIDTH - search.getBoundingClientRect().width : 0
  return Math.ceil(trayContentWidth(tray) + searchGain)
}

/** The bar as shown at `fold`: its width, the base, the tray's width and the shown layout tabs' (or picker's) width. */
export function measureTopBar(bar: HTMLElement, fold: TopBarFold, tabsKey: string): TopBarMeasure {
  const cs = getComputedStyle(bar)
  const gap = parseFloat(cs.columnGap) || 0
  let need = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  let layout = 0
  let shown = 0
  let tray: HTMLElement | null = null
  for (const child of Array.from(bar.children)) {
    if (!(child instanceof HTMLElement)) continue
    const part = child.dataset.foldPart
    if (part === FOLD_PART.tray) tray = child
    const ccs = getComputedStyle(child)
    if (ccs.display === 'none' || ccs.position === 'absolute' || ccs.position === 'fixed') continue
    // The centring gap is free space: only its place in the bar counts.
    if (part === FOLD_PART.centre) {
      need += shown > 0 ? gap : 0
      shown++
      continue
    }
    const margins = part === FOLD_PART.spring ? 0 : (parseFloat(ccs.marginLeft) || 0) + (parseFloat(ccs.marginRight) || 0)
    // The tray's own width is what the field's width decides; its place (gap, margins) is the base's.
    const width = part === FOLD_PART.tray ? 0 : child.offsetWidth
    need += width + margins + (shown > 0 ? gap : 0)
    shown++
    if (part === FOLD_PART.layout) layout = width
  }
  return {
    bar: bar.clientWidth,
    base: Math.ceil(need - layout),
    ...(tray ? { tray: measureTray(tray) } : {}),
    ...(tabsFolded(fold) ? { picker: layout } : { tabs: { width: layout, key: tabsKey } }),
  }
}

function sameMeasure(a: TopBarMeasure, b: TopBarMeasure): boolean {
  return a.bar === b.bar && a.base === b.base && a.tray === b.tray
    && a.tabs?.width === b.tabs?.width && a.tabs?.key === b.tabs?.key && a.picker === b.picker
}

/** The measure update for the bar as shown now, measured at once (the same object when nothing changed). */
function remeasure(bar: HTMLElement, shown: { fold: TopBarFold; tabsKey: string }) {
  const next = measureTopBar(bar, shown.fold, shown.tabsKey)
  return (prev: TopBarMeasure): TopBarMeasure => {
    const merged: TopBarMeasure = { ...prev, ...next }
    return sameMeasure(prev, merged) ? prev : merged
  }
}

/** The top bar's fold and the filter field's width at it (once measured). */
interface TopBarFoldState {
  fold: TopBarFold
  search: number
}

/**
 * The top bar's fold, measured (never a breakpoint): the filter field
 * narrows first, then the layout tabs fold, then the field narrows further.
 * `barRef` = the bar, whose children carry `data-fold-part`; `tabsKey` says
 * what the tabs show (their widths depend on it, not on their order);
 * `partsKey` changes when the bar's children do. Every resize of the bar or
 * a child re-measures; the narrowing itself measures the same.
 */
export function useTopBarFold(
  barRef: RefObject<HTMLElement | null>,
  tabsKey: string,
  partsKey: unknown,
): TopBarFoldState {
  const [measure, setMeasure] = useState<TopBarMeasure>({ bar: 0, base: 0 })
  const fold = topBarFold(measure, tabsKey)
  const latest = useLatestRef({ fold, tabsKey })
  // Measured after each resize of the bar or one of its parts (the window,
  // a renamed layout, the storage pill's state); the fold follows on the
  // next frame. Never synchronously inside the callback: that would flush
  // other components' pending renders while observations are delivered, and
  // resize what this and other observers watch again.
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setMeasure(remeasure(bar, latest.current)))
    observer.observe(bar)
    // The parts and what is in them: a part that shrinks (the tray) keeps
    // its box while its content changes.
    for (const child of Array.from(bar.children)) {
      observer.observe(child)
      for (const inner of Array.from(child.children)) observer.observe(inner)
    }
    return () => observer.disconnect()
  }, [barRef, latest, partsKey, fold])
  return { fold, search: searchWidth(measure, fold) }
}
