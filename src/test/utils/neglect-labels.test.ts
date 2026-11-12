import { describe, expect, it } from 'vitest'
import {
  NEGLECT_LABEL_GAP_PX,
  NEGLECT_LABEL_MAX_PX,
  NEGLECT_LABEL_MIN_PX,
  placeNeglectLabels,
  type LabelDot,
} from '../../utils/neglect-labels'

const FIELD = { width: 400, height: 300 }
const dot = (id: number, x: number, y: number, textWidth = 80, extra: Partial<LabelDot> = {}): LabelDot => ({ id, x, y, radius: 6, textWidth, ...extra })

describe('placeNeglectLabels', () => {
  it('a name goes right of its dot, whole, when there is room', () => {
    const placed = placeNeglectLabels([dot(1, 100, 100)], FIELD)
    expect(placed.get(1)).toEqual({ id: 1, side: 'right', offset: 6 + NEGLECT_LABEL_GAP_PX, width: 80 })
  })

  it('near the right edge it goes left; a long name is cut at the most a name takes', () => {
    expect(placeNeglectLabels([dot(1, 380, 100)], FIELD).get(1)).toMatchObject({ side: 'left', width: 80 })
    expect(placeNeglectLabels([dot(1, 100, 100, 500)], FIELD).get(1)).toMatchObject({ side: 'right', width: NEGLECT_LABEL_MAX_PX })
  })

  it('another dot in the way: the name is cut to the room before it, or goes to the other side, or isn’t shown', () => {
    // 70px of room on the right (cut), the left clear but for 94px: the whole name fits there.
    const leftClear = placeNeglectLabels([dot(1, 100, 100, 80), dot(2, 186, 100, 0)], FIELD)
    expect(leftClear.get(1)).toMatchObject({ side: 'left', width: 80 })
    // Both sides short of the whole name: the wider one, cut.
    const cut = placeNeglectLabels([dot(1, 100, 100, 120), dot(2, 186, 100, 0)], { width: 400, height: 300 })
    expect(cut.get(1)).toMatchObject({ side: 'left' })
    expect(cut.get(1)!.width).toBeLessThan(120)
    expect(cut.get(1)!.width).toBeGreaterThanOrEqual(NEGLECT_LABEL_MIN_PX)
    // Hemmed in on both sides: no name.
    const none = placeNeglectLabels([dot(1, 40, 100, 80), dot(2, 80, 100, 0), dot(3, 4, 100, 0)], FIELD)
    expect(none.has(1)).toBe(false)
  })

  it('a dot on another line is no obstacle', () => {
    const placed = placeNeglectLabels([dot(1, 100, 100), dot(2, 130, 130, 0)], FIELD)
    expect(placed.get(1)).toMatchObject({ side: 'right', width: 80 })
  })

  it('earlier dots get their names first; a later name keeps clear of them', () => {
    const placed = placeNeglectLabels([dot(1, 100, 100, 100), dot(2, 150, 104, 100)], FIELD)
    expect(placed.get(1)).toMatchObject({ side: 'left', width: 90 })
    expect(placed.get(2)).toMatchObject({ side: 'right', width: 100 })
    const a = placed.get(1)!
    const b = placed.get(2)!
    // No two names overlap.
    const span = (d: LabelDot, p: typeof a) => (p.side === 'right' ? [d.x + p.offset, d.x + p.offset + p.width] : [d.x - p.offset - p.width, d.x - p.offset])
    const [a0, a1] = span(dot(1, 100, 100), a)
    const [b0, b1] = span(dot(2, 150, 104), b)
    expect(a1! <= b0! || b1! <= a0!).toBe(true)
  })

  it('a badge: the name starts past it on its side, and other names keep clear of it', () => {
    const badged = dot(1, 100, 100, 80, { badge: { side: 'right', width: 14, height: 14 } })
    expect(placeNeglectLabels([badged], FIELD).get(1)).toMatchObject({ side: 'right', offset: 6 + 2 + 14 + NEGLECT_LABEL_GAP_PX })
    // A dot just left of the badge, a little above: its name would run into the badge, so it goes left.
    const other = dot(2, 95, 86, 80)
    expect(placeNeglectLabels([badged, other], FIELD).get(2)).toMatchObject({ side: 'left' })
  })

  it('the plot’s own words are kept clear; an unmeasured field places nothing', () => {
    const corner = { left: 0, top: 0, right: 70, bottom: 14 }
    expect(placeNeglectLabels([dot(1, 90, 8, 80)], FIELD, [corner]).get(1)).toMatchObject({ side: 'right' })
    expect(placeNeglectLabels([dot(1, 330, 8, 80)], FIELD, [{ left: 340, top: 0, right: 400, bottom: 14 }]).get(1)).toMatchObject({ side: 'left' })
    expect(placeNeglectLabels([dot(1, 100, 100)], { width: 0, height: 0 }).size).toBe(0)
  })
})
