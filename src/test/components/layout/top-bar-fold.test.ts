import { afterEach, describe, it, expect } from 'vitest'
import {
  measureTopBar, SEARCH_FOLDED_MIN_WIDTH, SEARCH_MIN_WIDTH, SEARCH_WIDTH, searchWidth, tabsFolded, topBarFold, type TopBarMeasure,
} from '../../../components/layout/use-top-bar-fold'

/**
 * The top bar's fold from measured widths (feedback P2): the filters never
 * fold — they are the field's pills —, so short of room the field narrows
 * (to `SEARCH_MIN_WIDTH`), then the layout tabs fold into the picker, then
 * the field narrows further (to `SEARCH_FOLDED_MIN_WIDTH`). Tabs not
 * measured yet (or showing other layouts since) count as fitting until they
 * are measured. The filtered-tasks panel has no say in the fold.
 */

/** A tray of 700 (the field `SEARCH_WIDTH` of it), base 200, tabs 250, picker 90. */
const m = (extra: Partial<TopBarMeasure>): TopBarMeasure => ({
  bar: 1200, base: 200, tray: 700, tabs: { width: 250, key: 'k' }, picker: 90, ...extra,
})
const shrink = SEARCH_WIDTH - SEARCH_MIN_WIDTH

describe('topBarFold', () => {
  it('nothing folds while the tray fits with its field narrowed', () => {
    expect(topBarFold(m({}), 'k')).toBe('none')
    expect(topBarFold(m({ bar: 200 + 700 - shrink + 250 }), 'k')).toBe('none')
  })

  it('then the layout tabs fold', () => {
    expect(topBarFold(m({ bar: 200 + 700 - shrink + 249 }), 'k')).toBe('tabs')
    expect(tabsFolded('tabs')).toBe(true)
    expect(tabsFolded('none')).toBe(false)
  })

  it('not measured yet: unfolded (JSDOM, the first frame)', () => {
    expect(topBarFold({ bar: 0, base: 0 }, 'k')).toBe('none')
    expect(topBarFold(m({ tray: undefined, bar: 100 }), 'k')).toBe('none')
  })

  it('tabs that show other layouts since they were measured are tried again', () => {
    expect(topBarFold(m({ bar: 800 }), 'k')).toBe('tabs')
    expect(topBarFold(m({ bar: 800 }), 'renamed')).toBe('none')
  })
})

describe('searchWidth', () => {
  it('the whole field while the tray fits', () => {
    expect(searchWidth(m({}), 'none')).toBe(SEARCH_WIDTH)
    expect(searchWidth({ bar: 0, base: 0 }, 'none')).toBe(SEARCH_WIDTH)
  })

  it('narrowed into the room the bar leaves it, down to the least', () => {
    expect(searchWidth(m({ bar: 1100 }), 'none')).toBe(SEARCH_WIDTH - 50)
    expect(searchWidth(m({ bar: 700 }), 'none')).toBe(SEARCH_MIN_WIDTH)
  })

  it('once the tabs fold, the room beside the picker, down to the folded least', () => {
    expect(searchWidth(m({ bar: 800 }), 'tabs')).toBe(SEARCH_WIDTH - (200 + 700 + 90 - 800))
    expect(searchWidth(m({ bar: 400 }), 'tabs')).toBe(SEARCH_FOLDED_MIN_WIDTH)
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

  /**
   * A bar 1200 wide: New task (28), the layout tabs (300), the tray (at 400)
   * with the funnel (24), the field (`SEARCH_WIDTH` — or narrowed to `search`) and the
   * Filter button (60); the right zone (120).
   */
  function bar(opts: { search?: number } = {}) {
    const search = opts.search ?? SEARCH_WIDTH
    const left = 400
    const tray = box(el('div', { 'data-fold-part': 'tray' },
      box(el('button'), left + 4, 24),
      box(el('div', { 'data-fold-search': '' }), left + 28, search),
      box(el('button'), left + 28 + search, 60)), left, 4 + 24 + search + 60)
    tray.style.marginLeft = '10px'
    const parts = [
      box(el('button'), 8, 28),
      box(el('div', { 'data-fold-part': 'layout' }), 40, 300),
      tray,
      box(el('div', { 'data-fold-part': 'spring' }), 1072, 120),
    ]
    const header = el('header', {}, ...parts)
    header.style.paddingLeft = '8px'
    header.style.paddingRight = '8px'
    header.style.columnGap = '4px'
    Object.defineProperty(header, 'clientWidth', { configurable: true, value: 1200 })
    document.body.append(header)
    return header
  }

  it('measures the tray with its field at the whole width', () => {
    const measured = measureTopBar(bar(), 'none', 'k')
    expect(measured).toMatchObject({ tray: 4 + 24 + SEARCH_WIDTH + 60 })
    // Padding 16, New task 28, the layout tabs' place, the tray's gap + margin, the right zone + gap.
    expect(measured).toMatchObject({ bar: 1200, base: 16 + 28 + 4 + 4 + 10 + 120 + 4, tabs: { width: 300, key: 'k' } })
  })

  it('a narrowed field measures at its whole width: narrowing changes no measure', () => {
    expect(measureTopBar(bar({ search: 300 }), 'none', 'k')).toEqual(measureTopBar(bar(), 'none', 'k'))
  })

  it('with the tabs folded, the picker’s width', () => {
    const measured = measureTopBar(bar(), 'tabs', 'k')
    expect(measured).toMatchObject({ picker: 300 })
    expect(measured.tabs).toBeUndefined()
  })
})
