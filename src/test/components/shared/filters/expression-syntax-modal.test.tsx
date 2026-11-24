import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { ExpressionSyntaxModal } from '../../../../components/shared/filters/ExpressionSyntaxModal'
import { parseExpression } from '../../../../utils/filter-expression'

afterEach(cleanup)

const TODAY = new Date(2026, 10, 6)
const opts = { today: TODAY, names: { person: () => 1, tag: () => 1, status: () => 1 } }

describe('ExpressionSyntaxModal — the When rows', () => {
  it('shows comparisons and relative days, the older words last', () => {
    render(<ExpressionSyntaxModal onClose={() => {}} />)
    const when = screen.getByRole('region', { name: 'When — after any date word' })
    const rows = within(when).getAllByText((_, el) => el?.tagName === 'CODE').map((el) => el.textContent)
    expect(rows).toEqual([
      'due fri',
      'due +3d  ·  created -30d',
      'due <= +2w  ·  created >= -3m',
      'due this week',
      'due <= fri  ·  due < fri',
      'followup >= +7d  ·  followup > +7d',
      'created <= -30d',
      'due < start of week',
      'due -3d..+7d  ·  due 11/1..11/30',
      'due within 3 days  ·  created within last 3 months',
      'not due this week',
      '(due this week or no due)',
      'due by fri  ·  due from mon',
    ])
    expect(within(when).getByText(/Days from today: \+3d in 3 days/)).toBeTruthy()
    expect(within(when).getByText(/The older words still read/)).toBeTruthy()
  })

  it('lists Planned beside the other dates (no unplanned shortcut)', () => {
    render(<ExpressionSyntaxModal onClose={() => {}} />)
    const which = screen.getByRole('region', { name: 'Which date' })
    const rows = within(which).getAllByText((_, el) => el?.tagName === 'CODE').map((el) => el.textContent)
    expect(rows.slice(0, 4)).toEqual([
      'due  ·  due any  ·  no due',
      'planned  ·  planned any  ·  planned none',
      'planned fri  ·  planned < today',
      'followup  ·  followup any  ·  no followup',
    ])
    expect(rows).not.toContain('unplanned')
    expect(within(which).getByText('Planned day, as the Planner plans it')).toBeTruthy()
    const examples = ['planned any', 'planned none', 'planned fri', 'planned < today']
    for (const example of examples) {
      const r = parseExpression(example, opts)
      expect(r.ok, `${example}: ${r.ok ? '' : r.error.message}`).toBe(true)
      if (r.ok) expect(r.expression).toMatchObject({ kind: 'date', field: 'planned' })
    }
  })

  it('shows only examples that read', () => {
    render(<ExpressionSyntaxModal onClose={() => {}} />)
    const when = screen.getByRole('region', { name: 'When — after any date word' })
    for (const el of within(when).getAllByText((_, e) => e?.tagName === 'CODE')) {
      for (const example of (el.textContent ?? '').split('  ·  ')) {
        const r = parseExpression(example, opts)
        expect(r.ok, `${example}: ${r.ok ? '' : r.error.message}`).toBe(true)
      }
    }
  })
})
