import { describe, expect, it } from 'vitest'
import { clampDockShare } from '../../../components/workspace/planner/planner-dock'
import { PLANNER_DOCK_SHARE_MAX, PLANNER_DOCK_SHARE_MIN } from '../../../models/workspace-layout'

/** Board R1: the portrait Planner's trays dock keeps each side's minimum and the stored bounds. */
describe('clampDockShare', () => {
  it('leaves a share inside the bounds as it is', () => {
    expect(clampDockShare(0.38, 800)).toBe(0.38)
    expect(clampDockShare(0.6, 800)).toBe(0.6)
  })

  it('keeps the dock its grip, a heading and a row (88px), and the days Today’s heading and a row (74px)', () => {
    expect(clampDockShare(0.05, 600)).toBeCloseTo(88 / 600)
    expect(clampDockShare(0.99, 600)).toBeCloseTo(1 - 74 / 600)
  })

  it('never past the stored bounds, however tall', () => {
    expect(clampDockShare(0, 4000)).toBe(PLANNER_DOCK_SHARE_MIN)
    expect(clampDockShare(1, 4000)).toBe(PLANNER_DOCK_SHARE_MAX)
  })

  it('unmeasured, the stored bounds alone', () => {
    expect(clampDockShare(0.02, 0)).toBe(PLANNER_DOCK_SHARE_MIN)
    expect(clampDockShare(0.97, 0)).toBe(PLANNER_DOCK_SHARE_MAX)
  })
})
