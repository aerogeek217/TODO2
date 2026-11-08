import { describe, it, expect } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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

  it('Important: the important colour with its fill; Focus alone draws no ring', () => {
    expect(ring({ important: true }).parts).toEqual([{
      part: 'important', tag: 'rect', stroke: 'var(--color-marker-important)', fill: 'var(--color-marker-important-fill)', dash: null, pathLength: null,
    }])
    expect(ring({ focus: true }).parts).toEqual([])
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

  it('Focus is a tight glow around the box, never an outline: with a ring, or alone around the plain box', () => {
    const { container } = render(<PriorityRing summary={{ ...NONE, focus: true, urgent: 'flag' }} completed={false} size={18} />)
    expect(container.querySelector('svg')).toHaveAttribute('data-priority-ring', 'urgent')
    const glow = container.querySelector<HTMLElement>('[data-focus-glow]')!
    // 4px blur, 1px spread at a row's 18px box, the box's 5px corner.
    expect(glow.style.boxShadow).toBe('0 0 4px 1px var(--color-marker-focus-glow)')
    expect(glow.style.borderRadius).toBe('5px')
    cleanup()
    // Focus alone: no ring at all (the box keeps its border), only the glow.
    const alone = render(<PriorityRing summary={{ ...NONE, focus: true }} completed={false} size={11} />)
    expect(alone.container.querySelector('[data-priority-ring]')).toBeNull()
    expect(alone.container.querySelector<HTMLElement>('[data-focus-glow]')!.style.boxShadow).toBe('0 0 2.5px 0.5px var(--color-marker-focus-glow)')
    cleanup()
    expect(ring({ urgent: 'flag' }).svg!.parentElement!.querySelector('[data-focus-glow]')).toBeNull()
  })

  it('named only when given a label (the phone row) — the ring, or the glow when Focus has no ring; else hidden', () => {
    render(<PriorityRing summary={{ ...NONE, focus: true }} completed={false} size={20} label="Priority: Focus" />)
    expect(screen.getByRole('img', { name: 'Priority: Focus' })).toHaveAttribute('data-focus-glow')
    cleanup()
    render(<PriorityRing summary={{ ...NONE, focus: true, important: true }} completed={false} size={20} label="Priority: Focus, Important" />)
    expect(screen.getByRole('img', { name: 'Priority: Focus, Important' })).toHaveAttribute('viewBox', '0 0 20 20')
    expect(document.querySelector('[data-focus-glow]')).toHaveAttribute('aria-hidden', 'true')
    cleanup()
    expect(ring({ urgent: 'flag' }).svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('a label with nothing to draw still names it: no priority, a completed task (cr33 U14)', () => {
    cleanup()
    render(<PriorityRing summary={NONE} completed={false} size={20} label="No priority" />)
    expect(screen.getByRole('img', { name: 'No priority' })).toBeEmptyDOMElement()
    expect(document.querySelector('[data-priority-ring], [data-focus-glow]')).toBeNull()
    cleanup()
    render(<PriorityRing summary={{ ...NONE, urgent: 'flag', focus: true }} completed size={20} label="Priority: Focus, Urgent" />)
    expect(screen.getByRole('img', { name: 'Priority: Focus, Urgent' })).toBeEmptyDOMElement()
    expect(document.querySelector('[data-priority-ring], [data-focus-glow]')).toBeNull()
    cleanup()
    // Unlabelled, nothing at all.
    const { container } = render(<PriorityRing summary={NONE} completed={false} size={18} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('priorityRing', () => {
  it('Focus is the glow, never a ring: alone it draws no ring', () => {
    expect(priorityRing({ focus: true, urgent: null, important: false }, false)).toEqual({ kind: 'none', urgentDashed: false, focusGlow: true })
    expect(priorityRing({ focus: true, urgent: 'flag', important: false }, false)).toEqual({ kind: 'urgent', urgentDashed: false, focusGlow: true })
    expect(priorityRing({ focus: true, urgent: 'date', important: true }, false)).toEqual({ kind: 'split', urgentDashed: true, focusGlow: true })
    expect(priorityRing({ focus: false, urgent: null, important: true }, false)).toEqual({ kind: 'important', urgentDashed: false, focusGlow: false })
  })

  it('completed: neither ring nor glow', () => {
    expect(priorityRing({ focus: true, urgent: 'flag', important: true }, true)).toEqual({ kind: 'none', urgentDashed: false, focusGlow: false })
  })
})
