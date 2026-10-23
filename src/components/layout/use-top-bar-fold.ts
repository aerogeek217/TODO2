import { useLayoutEffect, useState, type RefObject } from 'react'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { attrSelector } from '../../utils/dom-contract'
import { FOLD_HIDDEN_ATTR, FOLD_VALUE_ATTR, FOLD_VARIANT_ATTR, type FoldVariant } from '../shared/filters/FilterChipBar.shared'

/**
 * What of the top bar is folded so that it never wraps or overflows:
 * `none`; `filters` = the screen-filter buttons into the Filters menu;
 * `both` = the layout tabs into the layout picker too. Before anything
 * folds, the tray shrinks (`traySqueeze`): the search narrows, then long
 * filter values are cut.
 */
export type TopBarFold = 'none' | 'filters' | 'both'

/** Whether the filter buttons show as the one Filters menu. */
export function filtersFolded(fold: TopBarFold): boolean {
  return fold !== 'none'
}

/** Whether the layout tabs show as the layout picker. */
export function tabsFolded(fold: TopBarFold): boolean {
  return fold === 'both'
}

/** The search box's width, and the least it narrows to (its icon and `Search…` still show). */
export const SEARCH_WIDTH = 200
export const SEARCH_MIN_WIDTH = 110
/** The least a filter value is cut to (a shorter value is never cut): its first 6–8 letters and the ellipsis. */
export const VALUE_MIN_WIDTH = 56

/** A filter value shown on its button: the field and the value's natural width, px. */
export interface TrayValue {
  key: string
  width: number
}

/** What `topBarFold` decides from: widths measured in the bar, px. */
export interface TopBarMeasure {
  /** The bar's width. */
  bar: number
  /** What every fold needs besides the filter tray and the layout controls (padding, gaps, New task, the right zone). */
  base: number
  /** The tray with its filter buttons, at its natural width. */
  trayOpen?: number
  /** The same, shrunk as far as it goes (the search and the values at their least). */
  trayOpenMin?: number
  /** The tray with the Filters menu, at its natural width. */
  trayFolded?: number
  /** The same, shrunk as far as it goes (the search at its least). */
  trayFoldedMin?: number
  /** The values on the filter buttons, at their natural widths. */
  values?: readonly TrayValue[]
  /** The layout tabs, when last shown, with what they showed then (`tabsKey`). */
  tabs?: { width: number; key: string }
  /** The layout picker (the tabs folded), when last shown. */
  picker?: number
}

/**
 * The least fold whose parts fit the bar, the tray shrunk as far as it goes:
 * the filters fold first, then the layout tabs. A part not measured yet (or
 * tabs showing other layouts since) counts as fitting — it is shown,
 * measured, and folded again on the next frame when it doesn't fit.
 */
export function topBarFold(m: TopBarMeasure, tabsKey: string): TopBarFold {
  if (m.bar <= 0) return 'none'
  const folded = m.trayFoldedMin ?? m.trayFolded ?? 0
  const open = m.trayOpenMin ?? m.trayOpen ?? folded
  const tabs = m.tabs?.key === tabsKey ? m.tabs.width : 0
  if (m.base + open + tabs <= m.bar) return 'none'
  if (m.base + folded + tabs <= m.bar) return 'filters'
  return 'both'
}

/** The room the bar leaves the tray at `fold`; `null` before it is measured. */
export function trayRoom(m: TopBarMeasure, fold: TopBarFold): number | null {
  if (m.bar <= 0) return null
  return m.bar - m.base - ((tabsFolded(fold) ? m.picker : m.tabs?.width) ?? 0)
}

/** How the tray shrinks to fit: the search's width, and the width of each value that is cut (by field). */
export interface TraySqueeze {
  search: number
  values: Partial<Record<string, number>>
}

/**
 * The tray `natural` wide shrunk to `width`: the search narrows first (to
 * `SEARCH_MIN_WIDTH`), then the longest `values` are cut, evenly from the
 * top (each to no less than `VALUE_MIN_WIDTH`, a shorter one never). `null`
 * when it fits as it is. Past every least width the rest stays over.
 */
export function traySqueeze(natural: number, width: number, values: readonly TrayValue[] = []): TraySqueeze | null {
  let over = Math.ceil(natural - width)
  if (over <= 0) return null
  const search = Math.max(SEARCH_MIN_WIDTH, SEARCH_WIDTH - over)
  over -= SEARCH_WIDTH - search
  const cut: Partial<Record<string, number>> = {}
  if (over > 0 && values.length > 0) {
    const least = (v: TrayValue) => Math.min(v.width, VALUE_MIN_WIDTH)
    const freed = (level: number) => values.reduce((n, v) => n + Math.max(0, v.width - Math.max(level, least(v))), 0)
    // The highest whole width that frees enough when every longer value is cut to it.
    let level = 0
    if (freed(0) >= over) {
      let lo = 0
      let hi = Math.max(...values.map((v) => v.width))
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (freed(mid) >= over) lo = mid
        else hi = mid - 1
      }
      level = lo
    }
    for (const v of values) {
      const w = Math.max(least(v), Math.min(v.width, level))
      if (w < v.width) cut[v.key] = w
    }
  }
  return { search, values: cut }
}

/**
 * The bar's parts, by their `data-fold-part`: the filter tray, the slot
 * that stands in for it while it is lifted out of the bar (expanded over
 * the bar under the filtered-tasks panel), the layout controls and the
 * right zone (its auto margin is free space).
 */
export const FOLD_PART = { tray: 'tray', traySlot: 'tray-slot', layout: 'layout', spring: 'spring' } as const

/** On the tray's search box (`SEARCH_WIDTH` wide, narrowed by `traySqueeze`). */
export const FOLD_SEARCH_ATTR = 'data-fold-search'

/** A box's width; for a `display: contents` one (no box), its children's span with their margins. */
function variantWidth(el: HTMLElement): number {
  if (el.hasAttribute(FOLD_HIDDEN_ATTR)) return el.getBoundingClientRect().width
  let left = Infinity
  let right = -Infinity
  for (const child of Array.from(el.children)) {
    const r = child.getBoundingClientRect()
    const cs = getComputedStyle(child)
    left = Math.min(left, r.left - (parseFloat(cs.marginLeft) || 0))
    right = Math.max(right, r.right + (parseFloat(cs.marginRight) || 0))
  }
  return right > left ? right - left : 0
}

/**
 * The tray's width as its content needs it: the tray may be squeezed (its
 * box narrower, its fixed-width parts running past its edge — `scrollWidth`
 * misses a few px of that), so its padding plus the span of what is laid
 * out in it, margins included (a `display: contents` wrapper's children;
 * not the hidden folds).
 */
function trayContentWidth(tray: HTMLElement): number {
  let left = Infinity
  let right = -Infinity
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement) || child.hasAttribute(FOLD_HIDDEN_ATTR)) continue
      const cs = getComputedStyle(child)
      if (cs.display === 'contents') { visit(child); continue }
      if (cs.display === 'none') continue
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

type TrayMeasure = Pick<TopBarMeasure, 'trayOpen' | 'trayOpenMin' | 'trayFolded' | 'trayFoldedMin' | 'values'>

/**
 * The tray's width with its filter buttons and with the Filters menu, each
 * natural and shrunk as far as it goes, all measured now whatever is shown
 * or cut: the filter bar lays out both folds hidden at their natural widths
 * (`FilterChipBar`'s `measureFold`), so neither goes stale (a filter set or
 * cleared, Show N tasks come or gone) and each value's natural width is
 * known while it is cut; the search counts at `SEARCH_WIDTH`. Without the
 * hidden folds, only the shown one (`shownFolded`).
 */
function measureTray(tray: HTMLElement, shownFolded: boolean): TrayMeasure {
  const content = trayContentWidth(tray)
  const search = tray.querySelector<HTMLElement>(attrSelector(FOLD_SEARCH_ATTR))
  // The tray as if the search weren't narrowed.
  const searchGain = search ? SEARCH_WIDTH - search.getBoundingClientRect().width : 0
  const searchSlack = search ? SEARCH_WIDTH - SEARCH_MIN_WIDTH : 0
  const hidden = (v: FoldVariant) => tray.querySelector<HTMLElement>(`${attrSelector(FOLD_VARIANT_ATTR, v)}${attrSelector(FOLD_HIDDEN_ATTR)}`)
  const shown = tray.querySelector<HTMLElement>(`${attrSelector(FOLD_VARIANT_ATTR)}:not(${attrSelector(FOLD_HIDDEN_ATTR)})`)
  const open = hidden('open')
  const folded = hidden('folded')
  if (!open || !folded || !shown) {
    const natural = Math.ceil(content + searchGain)
    const min = natural - searchSlack
    return shownFolded ? { trayFolded: natural, trayFoldedMin: min } : { trayOpen: natural, trayOpenMin: min }
  }
  const rest = content + searchGain - variantWidth(shown)
  const values = Array.from(open.querySelectorAll<HTMLElement>(attrSelector(FOLD_VALUE_ATTR)))
    .map((el) => ({ key: el.getAttribute(FOLD_VALUE_ATTR) ?? '', width: Math.ceil(el.getBoundingClientRect().width) }))
  const valueSlack = values.reduce((n, v) => n + v.width - Math.min(v.width, VALUE_MIN_WIDTH), 0)
  const openWidth = rest + variantWidth(open)
  const foldedWidth = rest + variantWidth(folded)
  return {
    trayOpen: Math.ceil(openWidth),
    trayOpenMin: Math.ceil(openWidth - searchSlack - valueSlack),
    trayFolded: Math.ceil(foldedWidth),
    trayFoldedMin: Math.ceil(foldedWidth - searchSlack),
    values,
  }
}

/** The bar as shown at `fold`: its width, the base, the tray's widths and the shown layout tabs' (or picker's) width. */
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
    const margins = part === FOLD_PART.spring ? 0 : (parseFloat(ccs.marginLeft) || 0) + (parseFloat(ccs.marginRight) || 0)
    // The tray's own width is what each fold decides; its place (gap, margins) is the base's.
    const width = part === FOLD_PART.tray || part === FOLD_PART.traySlot ? 0 : child.offsetWidth
    need += width + margins + (shown > 0 ? gap : 0)
    shown++
    if (part === FOLD_PART.layout) layout = width
  }
  return {
    bar: bar.clientWidth,
    base: Math.ceil(need - layout),
    ...(tray ? measureTray(tray, filtersFolded(fold)) : {}),
    ...(tabsFolded(fold) ? { picker: layout } : { tabs: { width: layout, key: tabsKey } }),
  }
}

function sameValues(a: readonly TrayValue[] | undefined, b: readonly TrayValue[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((v, i) => v.key === b[i]?.key && v.width === b[i]?.width)
}

function sameMeasure(a: TopBarMeasure, b: TopBarMeasure): boolean {
  return a.bar === b.bar && a.base === b.base && a.trayOpen === b.trayOpen && a.trayFolded === b.trayFolded
    && a.trayOpenMin === b.trayOpenMin && a.trayFoldedMin === b.trayFoldedMin && sameValues(a.values, b.values)
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

/** The top bar's fold, how the tray shrinks at it, and the tray's widths (once measured). */
export interface TopBarFoldState {
  fold: TopBarFold
  /** The tray shrunk into the room the bar leaves it at `fold`; `null` = natural. */
  squeeze: TraySqueeze | null
  /** The tray with its filter buttons, natural. */
  trayOpen: number | undefined
  /** The same, shrunk as far as it goes. */
  trayOpenMin: number | undefined
  /** The tray with the Filters menu, natural. */
  trayFolded: number | undefined
  /** The values on the filter buttons, natural. */
  values: readonly TrayValue[] | undefined
}

/**
 * The top bar's fold, measured (never a breakpoint): the tray shrinks
 * first (the search, then long values), then the filters fold, then the
 * layout tabs. `barRef` = the bar, whose children carry `data-fold-part`;
 * `tabsKey` says what the tabs show (their widths depend on it, not on
 * their order); `partsKey` changes when the bar's children do. Every resize
 * of the bar or a child re-measures; the shrinking itself measures the same.
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
  const room = trayRoom(measure, fold)
  const folded = filtersFolded(fold)
  const natural = folded ? measure.trayFolded : measure.trayOpen
  const squeeze = room === null || natural === undefined ? null : traySqueeze(natural, room, folded ? [] : measure.values)
  return {
    fold,
    squeeze,
    trayOpen: measure.trayOpen,
    trayOpenMin: measure.trayOpenMin,
    trayFolded: measure.trayFolded,
    values: measure.values,
  }
}
