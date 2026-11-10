import { describe, expect, it } from 'vitest'
import { trendAxisStep } from '../../../components/workspace/glance/trend-axis'

describe('trendAxisStep', () => {
  it('labels every bucket while unmeasured or alone', () => {
    expect(trendAxisStep(0, 14, 2)).toBe(1)
    expect(trendAxisStep(300, 1, 6)).toBe(1)
  })

  it('labels every bucket where two-digit days fit their columns', () => {
    // 14 columns of ~29px: a 2-character label needs 20px.
    expect(trendAxisStep(460, 14, 2)).toBe(1)
  })

  it('thins the labels as the columns narrow', () => {
    // ~10px columns (14px apart): every second day.
    expect(trendAxisStep(190, 14, 2)).toBe(2)
    // ~4px columns (8px apart): every third.
    expect(trendAxisStep(110, 14, 2)).toBe(3)
  })

  it('gives wider labels (weeks, `Nov 10`) more room', () => {
    expect(trendAxisStep(360, 12, 6)).toBe(2)
    expect(trendAxisStep(180, 12, 6)).toBeGreaterThan(trendAxisStep(180, 12, 2))
  })
})
