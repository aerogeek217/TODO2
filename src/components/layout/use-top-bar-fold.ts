import { useLayoutEffect, useState, type RefObject } from 'react'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { attrSelector } from '../../utils/dom-contract'
import { FOLD_HIDDEN_ATTR, FOLD_VARIANT_ATTR, type FoldVariant } from '../shared/filters/FilterChipBar.shared'

/**
 * What of the top bar is folded so that it never wraps or overflows:
 * `none`; `filters` = the screen-filter buttons into the Filters menu;
 * `tabs` = the layout tabs into the layout picker, the filters kept (only
 * while the filtered-tasks panel is open: the tray gets the room); `both`.
 */
export type TopBarFold = 'none' | 'filters' | 'tabs' | 'both'

/** Whether the filter buttons show as the one Filters menu. */
export function filtersFolded(fold: TopBarFold): boolean {
  return fold === 'filters' || fold === 'both'
}

/** Whether the layout tabs show as the layout picker. */
export function tabsFolded(fold: TopBarFold): boolean {
  return fold === 'tabs' || fold === 'both'
}

/** What `topBarFold` decides from: widths measured in the bar, px. */
export interface TopBarMeasure {
  /** The bar's width. */
  bar: number
  /** What every fold needs besides the filter tray and the layout controls (padding, gaps, New task, the right zone). */
  base: number
  /** The tray with its filter buttons. */
  trayOpen?: number
  /** The tray with the Filters menu. */
  trayFolded?: number
  /** The layout tabs, when last shown, with what they showed then (`tabsKey`). */
  tabs?: { width: number; key: string }
  /** The layout picker (the layout controls with the tabs folded), when last shown. */
  picker?: number
}

/**
 * The least fold whose parts fit the bar. A part not measured yet (or tabs
 * showing other layouts since) counts as fitting — it is shown, measured,
 * and folded again on the next frame when it doesn't fit.
 *
 * Normally the filters fold first, then the layout tabs. While the
 * filtered-tasks panel is open (`panelOpen`) the tabs always fold into the
 * picker and the filters fold only when even that leaves them no room.
 */
export function topBarFold(m: TopBarMeasure, tabsKey: string, panelOpen = false): TopBarFold {
  const folded = m.trayFolded ?? 0
  const open = m.trayOpen ?? folded
  if (panelOpen) {
    if (m.bar <= 0) return 'tabs'
    return m.base + open + (m.picker ?? 0) <= m.bar ? 'tabs' : 'both'
  }
  if (m.bar <= 0) return 'none'
  const tabs = m.tabs?.key === tabsKey ? m.tabs.width : 0
  if (m.base + open + tabs <= m.bar) return 'none'
  if (m.base + folded + tabs <= m.bar) return 'filters'
  return 'both'
}

/** The bar's parts, by their `data-fold-part`: the filter tray, the layout controls and the right zone (its auto margin is free space). */
export const FOLD_PART = { tray: 'tray', layout: 'layout', spring: 'spring' } as const

/** A box's width; for a `display: contents` one (no box), its children's span. */
function variantWidth(el: HTMLElement): number {
  if (el.hasAttribute(FOLD_HIDDEN_ATTR)) return el.getBoundingClientRect().width
  let left = Infinity
  let right = -Infinity
  for (const child of Array.from(el.children)) {
    const r = child.getBoundingClientRect()
    left = Math.min(left, r.left)
    right = Math.max(right, r.right)
  }
  return right > left ? right - left : 0
}

/**
 * The tray's width as its content needs it: the tray may be squeezed (its
 * box narrower, its fixed-width parts running past its edge — `scrollWidth`
 * misses a few px of that), so its padding plus the span of what is laid
 * out in it (a `display: contents` wrapper's children; not the hidden fold).
 */
function trayContentWidth(tray: HTMLElement): number {
  let left = Infinity
  let right = -Infinity
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement) || child.hasAttribute(FOLD_HIDDEN_ATTR)) continue
      const display = getComputedStyle(child).display
      if (display === 'contents') { visit(child); continue }
      if (display === 'none') continue
      const r = child.getBoundingClientRect()
      left = Math.min(left, r.left)
      right = Math.max(right, r.right)
    }
  }
  visit(tray)
  const cs = getComputedStyle(tray)
  const padding = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  return right > left ? Math.max(tray.offsetWidth, right - left + padding) : tray.offsetWidth
}

/**
 * The tray's width with its filter buttons and with the Filters menu, both
 * measured now: the filter bar lays out the fold it doesn't show too,
 * hidden (`FilterChipBar`'s `measureFold`), so the width of the one not
 * shown never goes stale (a filter set or cleared, Show N tasks come or
 * gone). Without both variants, only the shown one (`shownFolded`).
 */
function measureTray(tray: HTMLElement, shownFolded: boolean): Pick<TopBarMeasure, 'trayOpen' | 'trayFolded'> {
  const content = trayContentWidth(tray)
  const variant = (v: FoldVariant) => tray.querySelector<HTMLElement>(attrSelector(FOLD_VARIANT_ATTR, v))
  const open = variant('open')
  const folded = variant('folded')
  if (!open || !folded) return shownFolded ? { trayFolded: content } : { trayOpen: content }
  const shown = open.hasAttribute(FOLD_HIDDEN_ATTR) ? folded : open
  const rest = content - variantWidth(shown)
  return { trayOpen: Math.ceil(rest + variantWidth(open)), trayFolded: Math.ceil(rest + variantWidth(folded)) }
}

/** The bar as shown at `fold`: its width, the base, the tray's widths and the shown layout controls' width. */
export function measureTopBar(bar: HTMLElement, fold: TopBarFold, tabsKey: string): TopBarMeasure {
  const cs = getComputedStyle(bar)
  const gap = parseFloat(cs.columnGap) || 0
  let need = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  let layout = 0
  let shown = 0
  let tray: HTMLElement | null = null
  for (const child of Array.from(bar.children)) {
    if (!(child instanceof HTMLElement)) continue
    const ccs = getComputedStyle(child)
    if (ccs.display === 'none' || ccs.position === 'absolute' || ccs.position === 'fixed') continue
    const part = child.dataset.foldPart
    const margins = part === FOLD_PART.spring ? 0 : (parseFloat(ccs.marginLeft) || 0) + (parseFloat(ccs.marginRight) || 0)
    // The tray's own width is what each fold decides; its place (gap, margins) is the base's.
    const width = part === FOLD_PART.tray ? 0 : child.offsetWidth
    need += width + margins + (shown > 0 ? gap : 0)
    shown++
    if (part === FOLD_PART.tray) tray = child
    else if (part === FOLD_PART.layout) layout = width
  }
  return {
    bar: bar.clientWidth,
    base: Math.ceil(need - layout),
    ...(tray ? measureTray(tray, filtersFolded(fold)) : {}),
    ...(tabsFolded(fold) ? { picker: layout } : { tabs: { width: layout, key: tabsKey } }),
  }
}

function sameMeasure(a: TopBarMeasure, b: TopBarMeasure): boolean {
  return a.bar === b.bar && a.base === b.base && a.trayOpen === b.trayOpen && a.trayFolded === b.trayFolded
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

/**
 * The top bar's fold, measured (never a breakpoint): the filters fold first,
 * then the layout tabs — while the filtered-tasks panel is open
 * (`panelOpen`), the tabs first. `barRef` = the bar, whose children carry
 * `data-fold-part`; `tabsKey` says what the tabs show (their widths depend
 * on it, not on their order); `partsKey` changes when the bar's children do.
 * Every resize of the bar or a child re-measures.
 */
export function useTopBarFold(
  barRef: RefObject<HTMLElement | null>,
  tabsKey: string,
  partsKey: unknown,
  panelOpen = false,
): TopBarFold {
  const [measure, setMeasure] = useState<TopBarMeasure>({ bar: 0, base: 0 })
  const fold = topBarFold(measure, tabsKey, panelOpen)
  const latest = useLatestRef({ fold, tabsKey })
  // Measured after each resize of the bar or one of its parts (the window,
  // a filter's value, a renamed layout, the storage pill's state); the fold
  // follows on the next frame. Never synchronously inside the callback: that
  // would flush other components' pending renders while observations are
  // delivered, and resize what this and other observers watch again.
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setMeasure(remeasure(bar, latest.current)))
    observer.observe(bar)
    // The parts and what is in them: a part that shrinks (the tray) keeps
    // its box while its content changes; the filter bar's hidden fold.
    for (const child of Array.from(bar.children)) {
      observer.observe(child)
      for (const inner of Array.from(child.children)) observer.observe(inner)
    }
    return () => observer.disconnect()
  }, [barRef, latest, partsKey, fold])
  return fold
}
