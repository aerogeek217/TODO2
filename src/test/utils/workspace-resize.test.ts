import { describe, it, expect } from 'vitest'
import { createTab } from '../../models/workspace-layout'
import { BAND_MIN_PX, expandedWeight, resizeBand } from '../../utils/workspace-resize'
import { GLANCE_ROW_MIN_PX, trackMinHeightPx } from '../../utils/workspace-rows'
import { cell, grid } from '../helpers/layout-builders'

describe('expandedWeight', () => {
  it('sums the weights, which may come to under 1 once a part has gone', () => {
    expect(expandedWeight([{ weight: 0.25 }, { weight: 0.25 }])).toBe(0.5)
  })

  it('leaves collapsed parts out: they take no free space', () => {
    expect(expandedWeight([{ weight: 2, collapsed: true }, { weight: 0.5 }, { weight: 0.25, collapsed: false }])).toBe(0.75)
    expect(expandedWeight([{ weight: 1, collapsed: true }])).toBe(0)
  })
})

describe('resizeBand', () => {
  it('follows the pointer: a top band grows going down, a bottom band going up; clamped to its minimum and the room left', () => {
    expect(resizeBand({ edge: 'top', startHeight: 160, delta: 40, max: 400 })).toEqual({ height: 200, raw: 200 })
    expect(resizeBand({ edge: 'bottom', startHeight: 160, delta: 40, max: 400 })).toEqual({ height: 120, raw: 120 })
    expect(resizeBand({ edge: 'top', startHeight: 160, delta: -100, max: 400 })).toEqual({ height: BAND_MIN_PX, raw: 60 })
    expect(resizeBand({ edge: 'top', startHeight: 160, delta: 400, max: 300 }).height).toBe(300)
  })

  it('a fixed row of glance widgets shrinks to 64px, like a glance row (cr33 W5)', () => {
    const numbers = grid([[cell('n1', [createTab('number', 'a')]), cell('n2', [createTab('number', 'b')])]])
    const min = trackMinHeightPx(numbers, 0)
    expect(min).toBe(GLANCE_ROW_MIN_PX)
    expect(resizeBand({ edge: 'top', startHeight: 150, delta: -70, max: 400, min }).height).toBe(80)
    expect(resizeBand({ edge: 'top', startHeight: 150, delta: -120, max: 400, min })).toEqual({ height: 64, raw: 30 })
    expect(trackMinHeightPx(grid([[cell('k', [createTab('notes', 'n')])]]), 0)).toBe(BAND_MIN_PX)
  })
})
