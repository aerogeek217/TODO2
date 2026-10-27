import { afterEach, describe, it, expect } from 'vitest'
import {
  filtersFolded, LENS_NAME_MIN_WIDTH, lensNameSqueeze, measureTopBar, SEARCH_MIN_WIDTH, SEARCH_WIDTH, tabsFolded, topBarFold, trayRoom,
  traySqueeze, VALUE_MIN_WIDTH, type TopBarMeasure,
} from '../../../components/layout/use-top-bar-fold'
import { LENS_NAME_MAX_WIDTH } from '../../../components/shared/filters/lens-fold'
import { trayExpansion } from '../../../components/layout/tray-expansion'

/**
 * The top bar's fold from measured widths: the least fold that fits with
 * the tray shrunk as far as it goes (the search narrowed, long values cut) —
 * the filters fold before the layout tabs; a part not measured yet (or tabs
 * showing other layouts since) counts as fitting until it is measured. The
 * tray's widths are all measured every time (the filter bar lays out both
 * folds hidden at their natural widths), so none goes stale and none
 * depends on what is shown or shrunk. The filtered-tasks panel has no say in
 * the fold: over folded filters the tray expands in place instead
 * (`trayExpansion`).
 */

const m = (extra: Partial<TopBarMeasure>): TopBarMeasure => ({
  bar: 1000, base: 200, trayOpen: 500, trayFolded: 300, tabs: { width: 250, key: 'k' }, ...extra,
})

describe('topBarFold', () => {
  it('nothing folds while everything fits', () => {
    expect(topBarFold(m({ bar: 950 }), 'k')).toBe('none')
  })

  it('the filters fold first', () => {
    expect(topBarFold(m({ bar: 900 }), 'k')).toBe('filters')
    expect(topBarFold(m({ bar: 750 }), 'k')).toBe('filters')
  })

  it('then the layout tabs', () => {
    expect(topBarFold(m({ bar: 749 }), 'k')).toBe('both')
  })

  it('not measured yet: unfolded (JSDOM, the first frame)', () => {
    expect(topBarFold({ bar: 0, base: 0 }, 'k')).toBe('none')
    // The open tray never seen: tried open.
    expect(topBarFold(m({ bar: 800, trayOpen: undefined }), 'k')).toBe('none')
  })

  it('tabs that show other layouts since they were measured are tried again', () => {
    expect(topBarFold(m({ bar: 650 }), 'k')).toBe('both')
    expect(topBarFold(m({ bar: 650 }), 'renamed')).toBe('filters')
  })

  it('decides from the shrunk widths: what fits shrunk doesn’t fold', () => {
    const shrinks = m({ trayOpenMin: 400, trayFoldedMin: 210 })
    expect(topBarFold({ ...shrinks, bar: 850 }, 'k')).toBe('none')
    expect(topBarFold({ ...shrinks, bar: 849 }, 'k')).toBe('filters')
    expect(topBarFold({ ...shrinks, bar: 660 }, 'k')).toBe('filters')
    expect(topBarFold({ ...shrinks, bar: 659 }, 'k')).toBe('both')
  })

  it('which parts each fold folds', () => {
    expect((['none', 'filters', 'both'] as const).map((f) => [filtersFolded(f), tabsFolded(f)])).toEqual([
      [false, false], [true, false], [true, true],
    ])
  })
})

describe('trayRoom', () => {
  it('the bar less the base and the layout tabs — or the picker once they fold', () => {
    expect(trayRoom(m({ picker: 90 }), 'none')).toBe(1000 - 200 - 250)
    expect(trayRoom(m({ picker: 90 }), 'filters')).toBe(1000 - 200 - 250)
    expect(trayRoom(m({ picker: 90 }), 'both')).toBe(1000 - 200 - 90)
    expect(trayRoom({ bar: 0, base: 0 }, 'none')).toBeNull()
  })
})

describe('traySqueeze', () => {
  const values = [{ key: 'people', width: 120 }, { key: 'tags', width: 90 }, { key: 'status', width: 40 }]
  const searchSlack = SEARCH_WIDTH - SEARCH_MIN_WIDTH

  it('nothing while the tray fits', () => {
    expect(traySqueeze(800, 800, values)).toBeNull()
    expect(traySqueeze(800, 900, values)).toBeNull()
  })

  it('the search narrows first, values untouched', () => {
    expect(traySqueeze(800, 760, values)).toEqual({ search: SEARCH_WIDTH - 40, values: {} })
    expect(traySqueeze(800, 800 - searchSlack, values)).toEqual({ search: SEARCH_MIN_WIDTH, values: {} })
  })

  it('then the longest values are cut, evenly from the top', () => {
    // 20 more: the longest alone, 120 → 100.
    expect(traySqueeze(800, 800 - searchSlack - 20, values)).toEqual({ search: SEARCH_MIN_WIDTH, values: { people: 100 } })
    // 40 more: both long ones, to 85 (35 + 5).
    expect(traySqueeze(800, 800 - searchSlack - 40, values)).toEqual({ search: SEARCH_MIN_WIDTH, values: { people: 85, tags: 85 } })
  })

  it('never below the least width; a value shorter than it is never cut', () => {
    expect(traySqueeze(800, 100, values)).toEqual({ search: SEARCH_MIN_WIDTH, values: { people: VALUE_MIN_WIDTH, tags: VALUE_MIN_WIDTH } })
  })

  it('the folded tray (no values) narrows only its search', () => {
    expect(traySqueeze(500, 300)).toEqual({ search: SEARCH_MIN_WIDTH, values: {} })
  })
})

describe('measureTopBar', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  /** Pins a box's geometry (JSDOM lays nothing out). */
  function box(el: HTMLElement, left: number, width: number) {
    el.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, bottom: 32, height: 32, x: left, y: 0, toJSON: () => ({}) })
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width })
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: width })
    return el
  }

  function el(tag: string, attrs: Record<string, string> = {}, ...children: HTMLElement[]) {
    const e = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    e.append(...children)
    return e
  }

  /** A hidden fold: laid out off to the side at its natural width. */
  function hiddenFold(variant: 'open' | 'folded', width: number, ...children: HTMLElement[]) {
    const fold = box(el('span', { 'data-fold-variant': variant, 'data-fold-hidden': '' }, ...children), 0, width)
    fold.style.position = 'fixed'
    return fold
  }

  /**
   * A bar 1200 wide: New task (28), the layout tabs (300), the tray (at 400)
   * with the funnel (24), the search (200 — or narrowed to `search`) and the
   * Filters menu shown (80 wide); hidden, the five buttons (420, a People
   * value 99.4 wide among them) and the menu (80); the right zone (120).
   */
  function bar(opts: { lifted?: boolean; search?: number } = {}) {
    const search = opts.search ?? 200
    const left = opts.lifted ? 150 : 400
    const shown = el('span', { 'data-fold-variant': 'folded' }, box(el('button'), left + 28 + search, 80))
    shown.style.display = 'contents'
    const open = hiddenFold('open', 420, box(el('span', { 'data-fold-value': 'people' }), 0, 99.4))
    const tray = box(el('div', { 'data-fold-part': 'tray' },
      box(el('button'), left + 4, 24),
      box(el('div', { 'data-fold-search': '' }), left + 28, search),
      shown, open, hiddenFold('folded', 80)), left, 28 + search + 80)
    tray.style.marginLeft = '10px'
    if (opts.lifted) tray.style.position = 'fixed'
    const parts = [
      box(el('button'), 8, 28),
      box(el('div', { 'data-fold-part': 'layout' }), 40, 300),
      ...(opts.lifted ? [box(el('div', { 'data-fold-part': 'tray-slot' }), 400, 260)] : []),
      tray,
      box(el('div', { 'data-fold-part': 'spring' }), 1072, 120),
    ]
    for (const p of parts) if (p.dataset.foldPart === 'tray-slot') p.style.marginLeft = '10px'
    const header = el('header', {}, ...parts)
    header.style.paddingLeft = '8px'
    header.style.paddingRight = '8px'
    header.style.columnGap = '4px'
    Object.defineProperty(header, 'clientWidth', { configurable: true, value: 1200 })
    document.body.append(header)
    return header
  }

  it('measures the tray with its buttons and with the Filters menu at once, whichever shows', () => {
    const measured = measureTopBar(bar(), 'filters', 'k')
    // The tray less the shown menu (308 − 80) plus each fold's width.
    expect(measured).toMatchObject({ trayFolded: 308, trayOpen: 648, values: [{ key: 'people', width: 100 }] })
    // Shrunk: the search at its least; the open one's value too.
    expect(measured).toMatchObject({
      trayFoldedMin: 308 - (SEARCH_WIDTH - SEARCH_MIN_WIDTH),
      trayOpenMin: 648 - (SEARCH_WIDTH - SEARCH_MIN_WIDTH) - (100 - VALUE_MIN_WIDTH),
    })
    // Padding 16, New task 28, the layout tabs' place, the tray's gap + margin, the right zone + gap.
    expect(measured).toMatchObject({ bar: 1200, base: 16 + 28 + 4 + 4 + 10 + 120 + 4, tabs: { width: 300, key: 'k' } })
  })

  it('a narrowed search measures at its natural width: shrinking changes no measure', () => {
    expect(measureTopBar(bar({ search: 130 }), 'filters', 'k')).toEqual(measureTopBar(bar(), 'filters', 'k'))
  })

  it('with the tabs folded, the picker’s width', () => {
    const measured = measureTopBar(bar(), 'both', 'k')
    expect(measured).toMatchObject({ picker: 300 })
    expect(measured.tabs).toBeUndefined()
  })

  it('while the tray is lifted out its slot keeps its place in the bar: the base and widths don’t change', () => {
    expect(measureTopBar(bar({ lifted: true }), 'filters', 'k')).toEqual(measureTopBar(bar(), 'filters', 'k'))
  })

  /** The bar with the lens control (130 wide, 6 margin) after the layout tabs, its name `shown` of `natural` wide. */
  function withLens(shown: number, natural: number) {
    const header = bar()
    const name = box(el('span', { 'data-lens-name': '' }), 350, shown)
    Object.defineProperty(name, 'scrollWidth', { configurable: true, value: natural })
    const lens = box(el('div', { 'data-fold-part': 'lens' }, name), 344, 130 - (Math.min(natural, LENS_NAME_MAX_WIDTH) - shown))
    lens.style.marginLeft = '6px'
    header.querySelector('[data-fold-part="layout"]')!.after(lens)
    return header
  }

  it('the lens control is a fixed part, in the base at its natural width however its name is cut', () => {
    const without = measureTopBar(bar(), 'both', 'k')
    const lens = measureTopBar(withLens(90, 90), 'both', 'k')
    expect(lens).toMatchObject({ base: without.base + 130 + 6 + 4, lensName: 90, picker: 300 })
    expect(measureTopBar(withLens(56, 90), 'both', 'k')).toEqual(lens)
    // Past the CSS cap the name never counts wider than it shows uncut.
    expect(measureTopBar(withLens(LENS_NAME_MAX_WIDTH, 400), 'both', 'k').lensName).toBe(LENS_NAME_MAX_WIDTH)
  })
})

describe('lensNameSqueeze', () => {
  // Room for the tray at `both`: 1000 − 200 − the picker (100) = 700.
  const both = (extra: Partial<TopBarMeasure>) => m({ picker: 100, trayFoldedMin: 650, lensName: 120, ...extra })

  it('uncut while the most folded bar holds the tray at its least, and never before the tabs fold', () => {
    expect(lensNameSqueeze(both({}), 'both')).toBeNull()
    expect(lensNameSqueeze(both({ trayFoldedMin: 700 }), 'both')).toBeNull()
    expect(lensNameSqueeze(both({ trayFoldedMin: 760 }), 'filters')).toBeNull()
    expect(lensNameSqueeze(both({ lensName: undefined, trayFoldedMin: 760 }), 'both')).toBeNull()
  })

  it('the last resort: cut by what the bar is short, to no less than its least; a short name never', () => {
    expect(lensNameSqueeze(both({ trayFoldedMin: 730 }), 'both')).toBe(90)
    expect(lensNameSqueeze(both({ trayFoldedMin: 900 }), 'both')).toBe(LENS_NAME_MIN_WIDTH)
    expect(lensNameSqueeze(both({ trayFoldedMin: 900, lensName: 50 }), 'both')).toBeNull()
  })
})

describe('trayExpansion', () => {
  it('from the tray’s own left, rightwards, when the window holds it', () => {
    expect(trayExpansion(345, 900, 1600)).toEqual({ left: 345, width: 900 })
    // Right up to the gutter.
    expect(trayExpansion(345, 900, 1261)).toEqual({ left: 345, width: 900 })
  })

  it('slid left only by what crosses the right gutter', () => {
    expect(trayExpansion(345, 900, 1200)).toEqual({ left: 284, width: 900 })
    expect(trayExpansion(345, 840, 1000)).toEqual({ left: 144, width: 840 })
  })

  it('never past the left gutter; too wide for the window less its gutters, none (the filters stay folded)', () => {
    expect(trayExpansion(345, 968, 1000)).toEqual({ left: 16, width: 968 })
    expect(trayExpansion(345, 969, 1000)).toBeNull()
  })

  it('shrunk before it slides: from its own left up to the gutter, down to its least width', () => {
    expect(trayExpansion(345, 900, 1200, 800)).toEqual({ left: 345, width: 839 })
    expect(trayExpansion(345, 900, 1161, 800)).toEqual({ left: 345, width: 800 })
    // Shrunk all the way, then slid.
    expect(trayExpansion(345, 900, 1000, 800)).toEqual({ left: 184, width: 800 })
    expect(trayExpansion(345, 900, 832, 800)).toEqual({ left: 16, width: 800 })
    expect(trayExpansion(345, 900, 831, 800)).toBeNull()
    // Room for all of it: natural.
    expect(trayExpansion(345, 900, 1600, 800)).toEqual({ left: 345, width: 900 })
  })
})
