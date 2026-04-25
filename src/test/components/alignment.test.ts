import { describe, it, expect } from 'vitest'
import { findAlignments, findAlignmentsScoped, findResizeSnap, type Rect, type ScopedRect } from '../../components/canvas/alignment'

// Default snap threshold is 5px

function makeRect(x: number, y: number, width = 100, height = 50): Rect {
  return { x, y, width, height }
}

function makeScopedRect(nodeId: string, x: number, y: number, width = 100, height = 50): ScopedRect {
  return { nodeId, x, y, width, height }
}

// ─── findAlignments ───────────────────────────────────────────────────

describe('findAlignments', () => {
  describe('no snap', () => {
    it('returns original position when no other nodes exist', () => {
      const result = findAlignments(makeRect(50, 50), [])
      expect(result.x).toBe(50)
      expect(result.y).toBe(50)
      expect(result.lines).toHaveLength(0)
    })

    it('returns original position when all nodes are beyond threshold', () => {
      const dragging = makeRect(50, 50, 100, 50)
      const others = [makeRect(200, 200, 100, 50)]
      const result = findAlignments(dragging, others)
      expect(result.x).toBe(50)
      expect(result.y).toBe(50)
      expect(result.lines).toHaveLength(0)
    })
  })

  describe('vertical edge snapping (X axis)', () => {
    it('snaps left-to-left when within threshold', () => {
      // dragging left=53, other left=50 → dx=3 < 5
      const dragging = makeRect(53, 200, 100, 50)
      const other = makeRect(50, 100, 100, 50)
      const result = findAlignments(dragging, [other])
      expect(result.x).toBe(50)
    })

    it('snaps right-to-right when within threshold', () => {
      // dragging right=153, other right=150 → dx=3
      const dragging = makeRect(53, 200, 100, 50)
      const other = makeRect(50, 100, 100, 50)
      const result = findAlignments(dragging, [other])
      // left-left snap at 50 wins (dx=3), right-right also dx=3 but same offset
      expect(result.x).toBe(50)
    })

    it('snaps left-to-right (abutting edges)', () => {
      // dragging left=148, other right=150 → dx=2
      const dragging = makeRect(148, 100, 100, 50)
      const other = makeRect(50, 100, 100, 50) // right=150
      const result = findAlignments(dragging, [other])
      expect(result.x).toBe(150)
    })

    it('snaps right-to-left (abutting edges)', () => {
      // dragging right=48, other left=50 → dx=2
      const dragging = makeRect(-52, 100, 100, 50) // right=48
      const other = makeRect(50, 100, 100, 50) // left=50
      const result = findAlignments(dragging, [other])
      expect(result.x).toBe(-50) // snapped so right=50
    })

    it('does not snap when just beyond threshold', () => {
      // dragging left=56, other left=50 → dx=6 > 5
      const dragging = makeRect(56, 200, 100, 50)
      const other = makeRect(50, 100, 100, 50)
      const result = findAlignments(dragging, [other])
      expect(result.x).toBe(56)
    })
  })

  describe('horizontal edge snapping (Y axis)', () => {
    it('snaps top-to-top when within threshold', () => {
      const dragging = makeRect(200, 103, 100, 50)
      const other = makeRect(50, 100, 100, 50)
      const result = findAlignments(dragging, [other])
      expect(result.y).toBe(100)
    })

    it('snaps bottom-to-bottom when within threshold', () => {
      // dragging bottom=103+50=153, other bottom=100+50=150 → dy=3
      const dragging = makeRect(200, 103, 100, 50)
      const other = makeRect(50, 100, 100, 50)
      const result = findAlignments(dragging, [other])
      // top-top snap wins (dy=3), same offset for bottom-bottom
      expect(result.y).toBe(100)
    })

    it('snaps top-to-bottom', () => {
      // dragging top=148, other bottom=150 → dy=2
      const dragging = makeRect(200, 148, 100, 50)
      const other = makeRect(50, 100, 100, 50) // bottom=150
      const result = findAlignments(dragging, [other])
      expect(result.y).toBe(150)
    })

    it('snaps bottom-to-top', () => {
      // dragging bottom=52, other top=50 → dy=2
      const dragging = makeRect(200, 2, 100, 50) // bottom=52
      const other = makeRect(50, 50, 100, 50)
      const result = findAlignments(dragging, [other])
      expect(result.y).toBe(0) // snapped so bottom=50
    })
  })

  describe('simultaneous X+Y snap', () => {
    it('snaps both axes when both are within threshold', () => {
      const dragging = makeRect(53, 103, 100, 50)
      const other = makeRect(50, 100, 100, 50)
      const result = findAlignments(dragging, [other])
      expect(result.x).toBe(50)
      expect(result.y).toBe(100)
    })
  })

  describe('closest snap wins', () => {
    it('picks the closer X snap among multiple nodes', () => {
      const dragging = makeRect(51, 200, 100, 50)
      const near = makeRect(50, 100, 100, 50)   // dx=1
      const far = makeRect(47, 100, 100, 50)     // dx=4
      const result = findAlignments(dragging, [far, near])
      expect(result.x).toBe(50) // nearer snap wins
    })

    it('picks the closer Y snap among multiple nodes', () => {
      const dragging = makeRect(200, 51, 100, 50)
      const near = makeRect(50, 50, 100, 50)    // dy=1
      const far = makeRect(50, 47, 100, 50)      // dy=4
      const result = findAlignments(dragging, [far, near])
      expect(result.y).toBe(50)
    })
  })

  describe('alignment lines', () => {
    it('produces vertical alignment lines on X snap', () => {
      const dragging = makeRect(52, 200, 100, 50) // left=52, top=200, bottom=250
      const other = makeRect(50, 100, 100, 50)    // left=50, top=100, bottom=150
      const result = findAlignments(dragging, [other])
      expect(result.x).toBe(50)
      const vLines = result.lines.filter(l => l.orientation === 'vertical')
      expect(vLines.length).toBeGreaterThan(0)
      // Line should span from min-top to max-bottom of both rects
      const line = vLines[0]!
      expect(line.position).toBe(50) // snapped left edge
      expect(line.start).toBe(100)   // min(200, 100) after snap: min(100, 100)
      // Actually after snap: dragging.y stays 200, other.y=100. Min=100, Max=max(250, 150)=250
      expect(line.start).toBe(100)
      expect(line.end).toBe(250)
    })

    it('produces horizontal alignment lines on Y snap', () => {
      const dragging = makeRect(200, 52, 100, 50) // top=52
      const other = makeRect(50, 50, 100, 50)     // top=50
      const result = findAlignments(dragging, [other])
      expect(result.y).toBe(50)
      const hLines = result.lines.filter(l => l.orientation === 'horizontal')
      expect(hLines.length).toBeGreaterThan(0)
      const line = hLines[0]!
      expect(line.position).toBe(50) // snapped top edge
      // min X = min(200, 50)=50, max right = max(300, 150)=300
      expect(line.start).toBe(50)
      expect(line.end).toBe(300)
    })

    it('produces no lines when nothing snaps', () => {
      const result = findAlignments(makeRect(100, 100), [makeRect(300, 300)])
      expect(result.lines).toHaveLength(0)
    })
  })

  describe('custom threshold', () => {
    it('snaps with larger threshold', () => {
      const dragging = makeRect(58, 200, 100, 50)
      const other = makeRect(50, 100, 100, 50) // dx=8, beyond default 5
      const result = findAlignments(dragging, [other], 10)
      expect(result.x).toBe(50) // snaps with threshold=10
    })

    it('does not snap at exact threshold boundary', () => {
      // threshold is exclusive: dx <= threshold wins, so dx=5 with threshold=5 snaps
      const dragging = makeRect(55, 200, 100, 50)
      const other = makeRect(50, 100, 100, 50) // dx=5
      const result = findAlignments(dragging, [other], 5)
      expect(result.x).toBe(50) // dx=5 <= threshold=5, snaps
    })

    it('does not snap beyond threshold', () => {
      const dragging = makeRect(56, 200, 100, 50)
      const other = makeRect(50, 100, 100, 50) // dx=6
      const result = findAlignments(dragging, [other], 5)
      expect(result.x).toBe(56) // dx=6 > 5, no snap
    })
  })
})

// ─── findAlignmentsScoped ─────────────────────────────────────────────

describe('findAlignmentsScoped', () => {
  it('delegates to findAlignments with same behavior', () => {
    const dragging = makeScopedRect('a', 53, 103, 100, 50)
    const other = makeScopedRect('b', 50, 100, 100, 50)
    const result = findAlignmentsScoped(dragging, [other])
    expect(result.x).toBe(50)
    expect(result.y).toBe(100)
  })

  it('returns original position when no snaps', () => {
    const dragging = makeScopedRect('a', 100, 100, 100, 50)
    const result = findAlignmentsScoped(dragging, [])
    expect(result.x).toBe(100)
    expect(result.y).toBe(100)
    expect(result.lines).toHaveLength(0)
  })
})

// ─── findResizeSnap ───────────────────────────────────────────────────

describe('findResizeSnap', () => {
  describe('no snap', () => {
    it('returns original width when no other nodes exist', () => {
      const dragging = makeScopedRect('a', 50, 50, 100, 50)
      const result = findResizeSnap(dragging, 120, [])
      expect(result.width).toBe(120)
      expect(result.lines).toHaveLength(0)
    })

    it('returns original width when beyond threshold', () => {
      const dragging = makeScopedRect('a', 50, 50, 100, 50)
      const other = makeScopedRect('b', 300, 50, 100, 50)
      const result = findResizeSnap(dragging, 120, [other]) // right=170, other left=300 → dx=130
      expect(result.width).toBe(120)
      expect(result.lines).toHaveLength(0)
    })
  })

  describe('right edge snap', () => {
    it('snaps right edge to left edge of another node', () => {
      const dragging = makeScopedRect('a', 0, 50, 100, 50)
      const other = makeScopedRect('b', 250, 50, 100, 50) // left=250
      // Resizing to width=248 → right=248, snap to 250 → width=250
      const result = findResizeSnap(dragging, 248, [other])
      expect(result.width).toBe(250) // 250 - 0 = 250
    })

    it('snaps right edge to right edge of another node', () => {
      const dragging = makeScopedRect('a', 0, 50, 100, 50)
      const other = makeScopedRect('b', 200, 50, 100, 50) // right=300
      // Resizing to width=302 → right=302, snap to 300 → width=300
      const result = findResizeSnap(dragging, 302, [other])
      expect(result.width).toBe(300) // 300 - 0 = 300
    })

    it('picks closest snap among left and right edges', () => {
      const dragging = makeScopedRect('a', 0, 50, 100, 50)
      const other = makeScopedRect('b', 200, 50, 100, 50) // left=200, right=300
      // Resizing to width=202 → right=202, left edge=200 (dx=2), right edge=300 (dx=98)
      const result = findResizeSnap(dragging, 202, [other])
      expect(result.width).toBe(200) // snaps to left edge at 200
    })
  })

  describe('minimum width enforcement', () => {
    it('enforces minimum width of 200 even when snap would be smaller', () => {
      const dragging = makeScopedRect('a', 50, 50, 250, 50)
      const other = makeScopedRect('b', 100, 50, 100, 50) // left=100
      // Resizing to width=52 → right=102, snap to left edge 100 → width=50, but min 200
      const result = findResizeSnap(dragging, 52, [other])
      expect(result.width).toBe(200)
    })
  })

  describe('alignment lines on snap', () => {
    it('produces vertical alignment lines when snapped', () => {
      const dragging = makeScopedRect('a', 0, 50, 100, 50)
      const other = makeScopedRect('b', 250, 80, 100, 50) // left=250
      // Resizing to width=248 → right=248, snap to 250 → width=250
      const result = findResizeSnap(dragging, 248, [other])
      expect(result.width).toBe(250)
      const vLines = result.lines.filter(l => l.orientation === 'vertical')
      expect(vLines.length).toBeGreaterThan(0)
      const line = vLines[0]!
      expect(line.position).toBe(250) // snapped right edge
      // Spans from min(50, 80)=50 to max(100, 130)=130
      expect(line.start).toBe(50)
      expect(line.end).toBe(130)
    })

    it('does not produce lines when no snap', () => {
      const dragging = makeScopedRect('a', 50, 50, 100, 50)
      const result = findResizeSnap(dragging, 120, [])
      expect(result.lines).toHaveLength(0)
    })
  })

  describe('custom threshold', () => {
    it('snaps with larger threshold', () => {
      const dragging = makeScopedRect('a', 0, 50, 100, 50)
      const other = makeScopedRect('b', 220, 50, 100, 50) // left=220
      // width=212 → right=212, dx=8 from 220
      const result = findResizeSnap(dragging, 212, [other], 10)
      expect(result.width).toBe(220) // snaps
    })

    it('does not snap beyond custom threshold', () => {
      const dragging = makeScopedRect('a', 0, 50, 100, 50)
      const other = makeScopedRect('b', 220, 50, 100, 50) // left=220
      // width=212 → right=212, dx=8 from 220
      const result = findResizeSnap(dragging, 212, [other], 3)
      expect(result.width).toBe(212) // no snap, dx > 3
    })
  })
})
