import { describe, expect, it } from 'vitest'
import { indicatorBox, pageOffset, pagerPosition } from '../../utils/column-pager'

describe('pagerPosition', () => {
  it('maps the scroll offset to a fractional column index (page width + gap per column)', () => {
    expect(pagerPosition(0, 390, 8, 3)).toBe(0)
    expect(pagerPosition(398, 390, 8, 3)).toBe(1)
    expect(pagerPosition(199, 390, 8, 3)).toBeCloseTo(0.5)
  })

  it('clamps to the first and last column', () => {
    expect(pagerPosition(-40, 390, 8, 3)).toBe(0)
    expect(pagerPosition(5000, 390, 8, 3)).toBe(2)
  })

  it('is 0 for a single column or an unmeasured pager', () => {
    expect(pagerPosition(120, 390, 8, 1)).toBe(0)
    expect(pagerPosition(120, 0, 8, 3)).toBe(0)
  })
})

describe('pageOffset', () => {
  it('is the inverse of pagerPosition at whole columns', () => {
    expect(pageOffset(2, 390, 8)).toBe(796)
    expect(pagerPosition(pageOffset(2, 390, 8), 390, 8, 3)).toBe(2)
    expect(pageOffset(-1, 390, 8)).toBe(0)
  })
})

describe('indicatorBox', () => {
  const items = [
    { left: 20, width: 40 },
    { left: 100, width: 60 },
    { left: 200, width: 80 },
  ]

  it('sits exactly under an item at a whole position', () => {
    expect(indicatorBox(items, 0)).toEqual({ left: 20, width: 40 })
    expect(indicatorBox(items, 2)).toEqual({ left: 200, width: 80 })
  })

  it('slides proportionally between neighbouring items', () => {
    expect(indicatorBox(items, 0.5)).toEqual({ left: 60, width: 50 })
    expect(indicatorBox(items, 1.25)).toEqual({ left: 125, width: 65 })
  })

  it('clamps out-of-range positions and handles an empty strip', () => {
    expect(indicatorBox(items, -1)).toEqual({ left: 20, width: 40 })
    expect(indicatorBox(items, 9)).toEqual({ left: 200, width: 80 })
    expect(indicatorBox([], 0)).toBeNull()
  })
})
