import { describe, it, expect } from 'vitest'
import { topBarFold, type TopBarMeasure } from '../../../components/layout/use-top-bar-fold'

/**
 * The top bar's fold from measured widths: the least fold that fits — the
 * filters fold before the layout tabs; a part not measured yet (or tabs
 * showing other layouts since) counts as fitting until it is measured.
 */

const m = (extra: Partial<TopBarMeasure>): TopBarMeasure => ({
  bar: 1000, base: 200, trayOpen: 500, trayFolded: 300, tabs: { width: 250, key: 'k' }, ...extra,
})

describe('topBarFold', () => {
  it('nothing folds while everything fits', () => {
    expect(topBarFold(m({ bar: 950 }), 'k')).toBe(0)
  })

  it('the filters fold first', () => {
    expect(topBarFold(m({ bar: 900 }), 'k')).toBe(1)
    expect(topBarFold(m({ bar: 750 }), 'k')).toBe(1)
  })

  it('then the layout tabs', () => {
    expect(topBarFold(m({ bar: 749 }), 'k')).toBe(2)
  })

  it('not measured yet: unfolded (JSDOM, the first frame)', () => {
    expect(topBarFold({ bar: 0, base: 0 }, 'k')).toBe(0)
    // The open tray never seen: tried open.
    expect(topBarFold(m({ bar: 800, trayOpen: undefined }), 'k')).toBe(0)
  })

  it('tabs that show other layouts since they were measured are tried again', () => {
    expect(topBarFold(m({ bar: 650 }), 'k')).toBe(2)
    expect(topBarFold(m({ bar: 650 }), 'renamed')).toBe(1)
  })
})
