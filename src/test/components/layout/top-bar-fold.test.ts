import { describe, it, expect } from 'vitest'
import { filtersFolded, tabsFolded, topBarFold, type TopBarMeasure } from '../../../components/layout/use-top-bar-fold'

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
