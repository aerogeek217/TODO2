import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, within } from '@testing-library/react'
import { TaskGroup } from '../../../components/canvas/shared/TaskGroup'

afterEach(cleanup)

/**
 * Mirrors the three preview states from
 * docs/plans/features/design_handoff_task_grouping/preview.html so the port
 * is reviewable on its own.
 */
describe('TaskGroup', () => {
  it('renders label, count, and children inside a section labelled by the group name', () => {
    const { getByRole } = render(
      <TaskGroup label="Roadmap" count={3}>
        <div data-testid="r1">row 1</div>
        <div data-testid="r2">row 2</div>
        <div data-testid="r3">row 3</div>
      </TaskGroup>,
    )
    const section = getByRole('region', { name: 'Roadmap' })
    expect(within(section).getByText('Roadmap')).toBeInTheDocument()
    expect(within(section).getByText('3')).toBeInTheDocument()
    expect(within(section).getByTestId('r1')).toBeInTheDocument()
    expect(within(section).getByTestId('r2')).toBeInTheDocument()
    expect(within(section).getByTestId('r3')).toBeInTheDocument()
  })

  it('preview state 1 — grouped with ungrouped items above (siblings, ungrouped first, headers on groups only)', () => {
    const { container, getAllByRole } = render(
      <div>
        <div data-testid="ungrouped">
          <div>Finalize quarterly budget</div>
          <div>Send all-hands agenda</div>
        </div>
        <TaskGroup label="Roadmap" count={3}>
          <div>Draft H1 roadmap doc</div>
          <div>Review OKRs with leadership</div>
          <div>Cut scope for milestone 2</div>
        </TaskGroup>
        <TaskGroup label="Hiring" count={2}>
          <div>Phone screen — candidate K</div>
          <div>Write IC4 rubric</div>
        </TaskGroup>
        <TaskGroup label="Operations" count={2}>
          <div>Q1 retro notes → Confluence</div>
          <div>Schedule offsite logistics</div>
        </TaskGroup>
      </div>,
    )
    const regions = getAllByRole('region')
    expect(regions.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Roadmap',
      'Hiring',
      'Operations',
    ])
    // Ungrouped block precedes the first group in document order.
    const ungrouped = container.querySelector('[data-testid="ungrouped"]')!
    expect(ungrouped.compareDocumentPosition(regions[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // No header is rendered on the ungrouped block.
    expect(ungrouped.querySelector('header')).toBeNull()
  })

  it('preview state 2 — grouped, no ungrouped items (first group is the first child of its parent)', () => {
    const { container, getAllByRole } = render(
      <div data-testid="list">
        <TaskGroup label="Roadmap" count={2}>
          <div>Draft H1 roadmap doc</div>
          <div>Review OKRs with leadership</div>
        </TaskGroup>
        <TaskGroup label="Hiring" count={2}>
          <div>Phone screen — candidate K</div>
          <div>Write IC4 rubric</div>
        </TaskGroup>
      </div>,
    )
    const regions = getAllByRole('region')
    expect(regions).toHaveLength(2)
    // The first group is the first child — :first-child CSS rule will zero its
    // top margin so it sits flush to the parent's top.
    const list = container.querySelector('[data-testid="list"]')!
    expect(list.firstElementChild).toBe(regions[0])
  })

  it('preview state 3 — no grouping renders no TaskGroup at all', () => {
    const { queryByRole, container } = render(
      <div>
        <div>Finalize quarterly budget</div>
        <div>Draft H1 roadmap doc</div>
        <div>Phone screen — candidate K</div>
        <div>Q1 retro notes → Confluence</div>
      </div>,
    )
    expect(queryByRole('region')).toBeNull()
    expect(container.querySelector('header')).toBeNull()
  })

  it('exposes the count and rule with the right ARIA semantics (rule is decorative)', () => {
    const { container, getByRole } = render(
      <TaskGroup label="Hiring" count={2}>
        <div>row</div>
      </TaskGroup>,
    )
    const section = getByRole('region', { name: 'Hiring' })
    const header = section.querySelector('header')!
    expect(header.textContent).toContain('Hiring')
    expect(header.textContent).toContain('2')
    const rule = container.querySelector('[aria-hidden="true"]')
    expect(rule).toBeTruthy()
  })

  it('renders no swatch when color is omitted', () => {
    const { getByRole } = render(
      <TaskGroup label="Roadmap" count={3}>
        <div>row</div>
      </TaskGroup>,
    )
    const section = getByRole('region', { name: 'Roadmap' })
    const header = section.querySelector('header')!
    // Header has the rule (aria-hidden="true") but no preceding swatch span
    // before the label. Concretely: the only aria-hidden element is the rule.
    expect(header.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1)
  })

  it('renders an 8 px circle swatch before the label when color is set', () => {
    const { getByRole } = render(
      <TaskGroup label="Hiring" count={2} color="#abc">
        <div>row</div>
      </TaskGroup>,
    )
    const section = getByRole('region', { name: 'Hiring' })
    const header = section.querySelector('header')!
    // Two aria-hidden children now: the leading swatch + the trailing rule.
    const decorative = header.querySelectorAll<HTMLElement>('[aria-hidden="true"]')
    expect(decorative).toHaveLength(2)
    const swatch = decorative[0]!
    expect(swatch.style.background).toBe('rgb(170, 187, 204)')
    // Swatch precedes the label in the document order.
    const label = within(section).getByText('Hiring')
    expect(swatch.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
