import { describe, expect, it } from 'vitest'
import {
  NEGLECT_LABEL_GAP_PX,
  NEGLECT_LABEL_HEIGHT_PX,
  NEGLECT_LABEL_MAX_PX,
  NEGLECT_LABEL_MIN_PX,
  NEGLECT_LABEL_WORK_MAX,
  placeNeglectLabels,
  uncrowdedMarks,
  type LabelDot,
  type LabelRect,
  type PlacedLabel,
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

// ── The placement's cost is bounded (cr34 G9 / S6) ──────────────────────────

/**
 * The placement as it was before the grid: every name against every box
 * (quadratic). Kept here as the reference the bounded one must agree with.
 */
function referencePlacement(dots: readonly LabelDot[], field: { width: number; height: number }, obstacles: readonly LabelRect[] = []): Map<number, PlacedLabel> {
  type Owned = LabelRect & { owner?: number }
  const placed = new Map<number, PlacedLabel>()
  if (field.width <= 0 || field.height <= 0) return placed
  const taken: Owned[] = [...obstacles]
  for (const d of dots) {
    taken.push({ left: d.x - d.radius, right: d.x + d.radius, top: d.y - d.radius, bottom: d.y + d.radius, owner: d.id })
    if (d.badge) {
      const bottom = d.y - d.radius + 2
      const left = d.badge.side === 'right' ? d.x + d.radius + 2 : d.x - d.radius - 2 - d.badge.width
      taken.push({ left, right: left + d.badge.width, top: bottom - d.badge.height, bottom, owner: d.id })
    }
  }
  const half = NEGLECT_LABEL_HEIGHT_PX / 2
  for (const d of dots) {
    if (d.textWidth <= 0) continue
    const want = Math.min(d.textWidth, NEGLECT_LABEL_MAX_PX)
    const top = d.y - half
    const bottom = d.y + half
    const room = (side: 'right' | 'left'): { offset: number; width: number } => {
      const past = d.badge?.side === side ? 2 + d.badge.width : 0
      const offset = d.radius + past + NEGLECT_LABEL_GAP_PX
      const start = side === 'right' ? d.x + offset : d.x - offset
      let end = side === 'right' ? field.width : 0
      for (const r of taken) {
        if (r.owner === d.id || r.bottom <= top || r.top >= bottom) continue
        if (side === 'right') { if (r.right > start) end = Math.min(end, r.left) } else if (r.left < start) end = Math.max(end, r.right)
      }
      return { offset, width: Math.max(0, side === 'right' ? end - start : start - end) }
    }
    const right = room('right')
    const left = room('left')
    const fit = right.width >= want ? { side: 'right' as const, ...right, width: want }
      : left.width >= want ? { side: 'left' as const, ...left, width: want }
        : right.width >= NEGLECT_LABEL_MIN_PX && right.width >= left.width ? { side: 'right' as const, ...right }
          : left.width >= NEGLECT_LABEL_MIN_PX ? { side: 'left' as const, ...left }
            : right.width >= NEGLECT_LABEL_MIN_PX ? { side: 'right' as const, ...right } : null
    if (!fit) continue
    placed.set(d.id, { id: d.id, side: fit.side, offset: fit.offset, width: fit.width })
    const start = fit.side === 'right' ? d.x + fit.offset : d.x - fit.offset - fit.width
    taken.push({ left: start, right: start + fit.width, top, bottom, owner: d.id })
  }
  return placed
}

/** A seeded generator in [0, 1). */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** Dots as the map places them: on day spots (61 across, 45 down), nudged off them. */
function mapDots(n: number, field: { width: number; height: number }, seed: number): LabelDot[] {
  const r = seeded(seed)
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    x: ((Math.floor(r() * 61) + (r() - 0.5) * 0.9) / 60) * field.width,
    y: ((Math.floor(r() * 45) + (r() - 0.5) * 0.9) / 44) * field.height,
    radius: r() < 0.3 ? 9.5 : 6,
    textWidth: 20 + r() * 220,
  }))
}

describe('placeNeglectLabels is bounded and places what the every-box placement placed', () => {
  it('random fields — dots on and off the field, badges, the plot’s words, short and long names — place the same names', () => {
    let names = 0
    for (let seed = 1; seed <= 120; seed++) {
      const r = seeded(seed)
      const field = { width: 150 + Math.floor(r() * 1100), height: 60 + Math.floor(r() * 600) }
      const n = 1 + Math.floor(r() * 140)
      const dots: LabelDot[] = Array.from({ length: n }, (_, i) => {
        // Some piled on one spot, some past the field's edges, some with no name to place.
        const piled = r() < 0.2
        const x = piled ? field.width * 0.7 + r() * 12 : -10 + r() * (field.width + 20)
        const y = piled ? field.height * 0.4 + r() * 10 : -5 + r() * (field.height + 10)
        const badge = r() < 0.2 ? { badge: { side: r() < 0.5 ? 'left' as const : 'right' as const, width: 14, height: 14 } } : {}
        return { id: i + 1, x, y, radius: r() < 0.3 ? 9.5 : 6, textWidth: r() < 0.1 ? 0 : 10 + r() * 240, ...badge }
      })
      const obstacles: LabelRect[] = [
        { left: 0, top: 0, right: 60 + r() * 40, bottom: 14 },
        { left: field.width - 70, top: field.height - 14, right: field.width, bottom: field.height },
      ]
      const placed = placeNeglectLabels(dots, field, obstacles)
      expect([...placed], `seed ${seed}`).toEqual([...referencePlacement(dots, field, obstacles)])
      names += placed.size
    }
    // The fields aren't all too crowded to name anything.
    expect(names).toBeGreaterThan(500)
  })

  it('a map of a few thousand tasks is placed in a small share of the budget: the names don’t change when it is cut twentyfold', () => {
    const field = { width: 1200, height: 700 }
    for (const n of [500, 3000]) {
      const dots = mapDots(n, field, n)
      const full = placeNeglectLabels(dots, field)
      // Every box against every name would be n × 2n tests (18 million at 3,000).
      expect([...placeNeglectLabels(dots, field, [], NEGLECT_LABEL_WORK_MAX / 20)]).toEqual([...full])
      expect([...full]).toEqual([...referencePlacement(dots, field)])
    }
  })

  it('past the budget no further name is tried: the dots given first got theirs', () => {
    const field = { width: 1200, height: 700 }
    // A lone dot with all the room it needs, after (or before) a crowd.
    const lone: LabelDot = { id: 99_999, x: 900, y: 650, radius: 6, textWidth: 80 }
    const crowd = mapDots(400, { width: 600, height: 500 }, 7)
    expect(placeNeglectLabels([...crowd, lone], field).get(lone.id)).toMatchObject({ side: 'right', width: 80 })
    // A budget the crowd uses up: the lone dot, last, isn't tried — first, it is.
    expect(placeNeglectLabels([...crowd, lone], field, [], 200).has(lone.id)).toBe(false)
    expect(placeNeglectLabels([lone, ...crowd], field, [], 200).get(lone.id)).toMatchObject({ side: 'right', width: 80 })
    // The names placed before the budget ran out are the ones an unbounded run places first.
    const cut = placeNeglectLabels(crowd, field, [], 200)
    const all = placeNeglectLabels(crowd, field)
    expect(cut.size).toBeLessThan(all.size)
    for (const [id, label] of cut) expect(all.get(id)).toEqual(label)
  })

  it('20,000 dots on one spot, in one column or all over stop at the budget (the every-box placement took seconds)', () => {
    const field = { width: 1200, height: 700 }
    const r = seeded(3)
    const pile: LabelDot[] = Array.from({ length: 20_000 }, (_, i) => ({ id: i + 1, x: 1180 - r() * 18, y: 300 + (r() - 0.5) * 14, radius: 6, textWidth: 40 + r() * 200 }))
    const column: LabelDot[] = Array.from({ length: 20_000 }, (_, i) => ({ id: i + 1, x: 300 + r() * 8, y: r() * field.height, radius: 6, textWidth: 40 + r() * 200 }))
    for (const dots of [pile, column, mapDots(20_000, field, 5)]) {
      const started = performance.now()
      const placed = placeNeglectLabels(dots, field)
      // Generous: tens of milliseconds on this machine; the quadratic placement took 15 s at this size.
      expect(performance.now() - started).toBeLessThan(5000)
      // No two names overlap, whatever was cut off by the budget.
      const boxes = [...placed.values()].map((p) => {
        const d = dots[p.id - 1]!
        const left = p.side === 'right' ? d.x + p.offset : d.x - p.offset - p.width
        return { left, right: left + p.width, top: d.y - NEGLECT_LABEL_HEIGHT_PX / 2, bottom: d.y + NEGLECT_LABEL_HEIGHT_PX / 2 }
      })
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true)
      }
    }
  })
})

describe('uncrowdedMarks: an axis mark that may give way', () => {
  /** Under this many px between two labels, the optional mark gives way. */
  const NEGLECT_MARK_MIN_GAP_PX = 4
  const keys = (marks: Array<{ key: string }>) => marks.map((m) => m.key)
  // The y axis: `14d late` from the top, `Today` and `+Nd` centred on theirs, `+30d` up to the bottom (11px labels).
  const y = (soonAt: number, h = 300) => [
    { key: 'top', start: 0, end: 11 },
    { key: 'today', start: 95 - 5.5, end: 95 + 5.5 },
    { key: 'soon', start: soonAt - 5.5, end: soonAt + 5.5 },
    { key: 'bottom', start: h - 11, end: h },
  ]

  it('keeps it with room on both sides', () => {
    expect(keys(uncrowdedMarks(y(140, 300), 'soon'))).toEqual(['top', 'today', 'soon', 'bottom'])
  })

  it('drops it under the gap to the mark before it, or after it, or over either', () => {
    // A gap of the minimum is kept; a px less gives way.
    expect(keys(uncrowdedMarks(y(95 + 11 + NEGLECT_MARK_MIN_GAP_PX), 'soon'))).toContain('soon')
    expect(keys(uncrowdedMarks(y(95 + 11 + NEGLECT_MARK_MIN_GAP_PX - 1), 'soon'))).toEqual(['top', 'today', 'bottom'])
    expect(keys(uncrowdedMarks(y(286, 300), 'soon'))).toEqual(['top', 'today', 'bottom'])
    expect(keys(uncrowdedMarks(y(97), 'soon'))).toEqual(['top', 'today', 'bottom'])
  })

  it('never drops another mark, and keeps the order given', () => {
    // The x axis: `30d` centred, `60d+ untouched` (85px) up to the right end.
    const x = [
      { key: 'zero', start: 0, end: 14 },
      { key: 'threshold', start: 40, end: 60 },
      { key: 'mid', start: 90, end: 110 },
      { key: 'cap', start: 112, end: 197 },
    ]
    expect(keys(uncrowdedMarks(x, 'mid'))).toEqual(['zero', 'threshold', 'cap'])
    expect(keys(uncrowdedMarks(x, 'none'))).toEqual(['zero', 'threshold', 'mid', 'cap'])
  })
})
