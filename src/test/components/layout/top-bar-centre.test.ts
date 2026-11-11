import { describe, expect, it } from 'vitest'
import { centreOffset, type CentreMeasure } from '../../../components/layout/use-top-bar-centre'

/**
 * The centring gap before the top bar's lens-and-filter group: the group at
 * rest centred in the bar; grown by chips it keeps its left edge until it
 * would reach the right zone, then moves left, never past its start.
 */

// A 1440 bar; the group may start at 300 (the tabs' least gap); at rest 400 wide; the right zone from 1300.
const m = (extra: Partial<CentreMeasure>): CentreMeasure => ({
  barLeft: 0, barWidth: 1440, start: 300, restWidth: 400, groupWidth: 400, rightLeft: 1300, ...extra,
})

describe('centreOffset', () => {
  it('at rest: the group centred in the bar', () => {
    // Centred: its left at (1440 − 400) / 2 = 520, so 220 past its start.
    expect(centreOffset(m({}))).toBe(220)
  })

  it('a chip or the counter grows it rightwards: the left edge stays while there is room', () => {
    expect(centreOffset(m({ groupWidth: 600 }))).toBe(220)
    expect(centreOffset(m({ groupWidth: 780 }))).toBe(220)
  })

  it('then it moves left by what would cross the right zone', () => {
    expect(centreOffset(m({ groupWidth: 800 }))).toBe(200)
    expect(centreOffset(m({ groupWidth: 1000 }))).toBe(0)
  })

  it('never left of its start (the tabs’ least gap): past that the fold takes over', () => {
    expect(centreOffset(m({ groupWidth: 1200 }))).toBe(0)
    // Wide tabs: centring would collide with them.
    expect(centreOffset(m({ start: 700 }))).toBe(0)
    expect(centreOffset(m({ start: 500 }))).toBe(20)
  })

  it('in whole px, from the bar’s own left', () => {
    expect(centreOffset(m({ barLeft: 10, barWidth: 1441, start: 310 }))).toBe(221)
  })
})
