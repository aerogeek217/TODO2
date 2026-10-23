import { afterEach, describe, it, expect } from 'vitest'
import { filtersFolded, measureTopBar, tabsFolded, topBarFold, type TopBarMeasure } from '../../../components/layout/use-top-bar-fold'

/**
 * The top bar's fold from measured widths: the least fold that fits — the
 * filters fold before the layout tabs; a part not measured yet (or tabs
 * showing other layouts since) counts as fitting until it is measured.
 * While the filtered-tasks panel is open the tabs fold into the picker
 * first, and the filters only when even that leaves them no room.
 */

const m = (extra: Partial<TopBarMeasure>): TopBarMeasure => ({
  bar: 1000, base: 200, trayOpen: 500, trayFolded: 300, tabs: { width: 250, key: 'k' }, picker: 100, ...extra,
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

  describe('while the filtered-tasks panel is open', () => {
    it('the tabs fold even when everything fits; the filters keep their buttons', () => {
      expect(topBarFold(m({ bar: 1200 }), 'k', true)).toBe('tabs')
      // Where the filters would fold first, the tabs give them the room.
      expect(topBarFold(m({ bar: 900 }), 'k', true)).toBe('tabs')
      expect(topBarFold(m({ bar: 800 }), 'k', true)).toBe('tabs')
    })

    it('the filters fold too only when the picker leaves them no room', () => {
      expect(topBarFold(m({ bar: 799 }), 'k', true)).toBe('both')
    })

    it('not measured yet: the tabs folded, the filters tried open', () => {
      expect(topBarFold({ bar: 0, base: 0 }, 'k', true)).toBe('tabs')
      expect(topBarFold(m({ bar: 750, picker: undefined, trayOpen: undefined }), 'k', true)).toBe('tabs')
    })
  })

  it('which parts each fold folds', () => {
    expect((['none', 'filters', 'tabs', 'both'] as const).map((f) => [filtersFolded(f), tabsFolded(f)])).toEqual([
      [false, false], [true, false], [false, true], [true, true],
    ])
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
   * with the Filters menu shown (80 wide) and the five buttons hidden (420),
   * the right zone (120).
   */
  function bar() {
    const shown = el('span', { 'data-fold-variant': 'folded' }, box(el('button'), 500, 80))
    shown.style.display = 'contents'
    const hidden = box(el('span', { 'data-fold-variant': 'open', 'data-fold-hidden': '' }), 0, 420)
    hidden.style.position = 'fixed'
    const tray = box(el('div', { 'data-fold-part': 'tray' }, box(el('button'), 404, 24), shown, hidden), 400, 260)
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

  it('measures the tray with its buttons and with the Filters menu at once, whichever shows', () => {
    const measured = measureTopBar(bar(), 'filters', 'k')
    // The tray less the shown menu (260 − 80) plus each fold's width.
    expect(measured).toMatchObject({ trayFolded: 260, trayOpen: 600 })
    // Padding 16, New task 28, the layout tabs' place, the tray's gap + margin, the right zone + gap.
    expect(measured).toMatchObject({ bar: 1200, base: 16 + 28 + 4 + 4 + 10 + 120 + 4, tabs: { width: 300, key: 'k' } })
  })
})
