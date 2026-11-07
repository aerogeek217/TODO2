import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriorityRing } from '../../../components/shared/PriorityRing'
import { priorityRing, type MarkerSummary } from '../../../utils/markers'

type Marks = Pick<MarkerSummary, 'focus' | 'urgent' | 'important'>

const NONE: Marks = { focus: false, urgent: null, important: false }

function ring(marks: Partial<Marks>, completed = false) {
  const { container } = render(<PriorityRing summary={{ ...NONE, ...marks }} completed={completed} size={18} />)
  const svg = container.querySelector('svg')
  const parts = Array.from(container.querySelectorAll<SVGElement>('[data-ring-part]')).map((el) => ({
    part: el.getAttribute('data-ring-part'),
    tag: el.tagName.toLowerCase(),
    stroke: el.style.stroke,
    fill: el.style.fill,
    dash: el.getAttribute('stroke-dasharray'),
    pathLength: el.getAttribute('pathLength'),
  }))
  return { svg, parts }
}

describe('PriorityRing (D25 B)', () => {
  it('no priority, or a completed task: nothing drawn', () => {
    expect(ring({}).svg).toBeNull()
    expect(ring({ urgent: 'flag', important: true, focus: true }, true).svg).toBeNull()
  })

  it('Urgent: a solid 2px ring in the urgent colour with its fill', () => {
    const { svg, parts } = ring({ urgent: 'flag' })
    expect(svg).toHaveAttribute('data-priority-ring', 'urgent')
    expect(svg).toHaveAttribute('stroke-width', '2')
    expect(parts).toEqual([{
      part: 'urgent', tag: 'rect', stroke: 'var(--color-marker-urgent)', fill: 'var(--color-marker-urgent-fill)', dash: null, pathLength: null,
    }])
  })

  it('Important: the important colour with its fill; Focus: the accent ring, no fill', () => {
    expect(ring({ important: true }).parts).toEqual([{
      part: 'important', tag: 'rect', stroke: 'var(--color-marker-important)', fill: 'var(--color-marker-important-fill)', dash: null, pathLength: null,
    }])
    expect(ring({ focus: true }).parts).toEqual([{
      part: 'focus', tag: 'rect', stroke: 'var(--color-marker-focus)', fill: 'none', dash: null, pathLength: null,
    }])
  })

  it('urgent only by its due date: finely dashed (2 / 1.5), a whole number of dashes round the box, no fill', () => {
    const { svg, parts } = ring({ urgent: 'date' })
    expect(svg).toHaveAttribute('data-priority-ring', 'urgent')
    expect(parts).toHaveLength(1)
    const [p] = parts
    expect(p).toMatchObject({ part: 'urgent', stroke: 'var(--color-marker-urgent)', fill: 'none', dash: '2 1.5' })
    const length = Number(p?.pathLength)
    expect(length % 3.5).toBeCloseTo(0)
    // About the box's perimeter: 4 × (16 − 8) + 2π × 4 ≈ 57.1.
    expect(Math.abs(length - 57.1)).toBeLessThan(3.5)
  })

  it('Urgent + Important: a split ring — the urgent half first (top-right), then the important half (bottom-left), no fill', () => {
    const { svg, parts } = ring({ urgent: 'flag', important: true })
    expect(svg).toHaveAttribute('data-priority-ring', 'split')
    expect(parts.map((p) => [p.part, p.tag, p.stroke, p.fill, p.dash])).toEqual([
      ['urgent', 'path', 'var(--color-marker-urgent)', 'none', null],
      ['important', 'path', 'var(--color-marker-important)', 'none', null],
    ])
    // The urgent half runs from the top-left corner along the top and right edges to the bottom-right corner.
    const d = svg!.querySelector('[data-ring-part="urgent"]')!.getAttribute('d')!
    expect(d).toMatch(/^M2\.17\d* 2\.17\d* /)
    expect(d).toContain('H13')
    expect(d).toContain('V13')
  })

  it('urgent by date + Important: the split with its urgent half dashed', () => {
    const { parts } = ring({ urgent: 'date', important: true })
    expect(parts.map((p) => [p.part, p.dash])).toEqual([['urgent', '2 1.5'], ['important', null]])
  })

  it('Focus under another ring: a halo in the Focus colour just outside the box; Focus alone has none', () => {
    const { svg } = ring({ focus: true, urgent: 'flag' })
    expect(svg).toHaveAttribute('data-priority-ring', 'urgent')
    const halo = svg!.querySelector('[data-focus-halo]')!
    expect(halo.getAttribute('style')).toContain('var(--color-marker-focus)')
    // Outside the 18px box: it starts left of and above it.
    expect(Number(halo.getAttribute('x'))).toBeLessThan(0)
    expect(Number(halo.getAttribute('width'))).toBeGreaterThan(18)
    expect(ring({ focus: true }).svg!.querySelector('[data-focus-halo]')).toBeNull()
    expect(ring({ urgent: 'flag' }).svg!.querySelector('[data-focus-halo]')).toBeNull()
  })

  it('named only when given a label (the phone row); else hidden', () => {
    render(<PriorityRing summary={{ ...NONE, focus: true }} completed={false} size={20} label="Priority: Focus" />)
    expect(screen.getByRole('img', { name: 'Priority: Focus' })).toHaveAttribute('viewBox', '0 0 20 20')
    expect(ring({ focus: true }).svg).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('priorityRing', () => {
  it('Focus under another ring adds the halo; alone it is the ring', () => {
    expect(priorityRing({ focus: true, urgent: null, important: false }, false)).toEqual({ kind: 'focus', urgentDashed: false, focusHalo: false })
    expect(priorityRing({ focus: true, urgent: 'flag', important: false }, false)).toEqual({ kind: 'urgent', urgentDashed: false, focusHalo: true })
    expect(priorityRing({ focus: true, urgent: 'date', important: true }, false)).toEqual({ kind: 'split', urgentDashed: true, focusHalo: true })
    expect(priorityRing({ focus: true, urgent: null, important: true }, false)).toEqual({ kind: 'important', urgentDashed: false, focusHalo: true })
  })

  it('completed: none, no halo', () => {
    expect(priorityRing({ focus: true, urgent: 'flag', important: true }, true)).toEqual({ kind: 'none', urgentDashed: false, focusHalo: false })
  })
})
