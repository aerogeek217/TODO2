import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DateAnchor, DateFilters } from '../../../../models'
import { RELATIVE_DATE_TOKENS } from '../../../../models/filter-predicate'
import type { DateField } from '../../../../models/app-view'
import { DateFilterPanel } from '../../../../components/shared/filters/DateFilterPanel'

/**
 * Looking writes nothing (P7–P8 review): the date panel opened on every
 * saved shape a clause can have — dates, day counts either way and 0, every
 * rolling day (the legacy ones too, and a From holding end of week), a mix,
 * "is not", "also tasks with no …", Any / None, Completed — with every menu
 * opened and closed with Esc, every box focused and left, and every tab
 * visited, calls `onChange` not once. Today is Mon 2 Nov 2026.
 */

const fixed = (y: number, m: number, d: number): DateAnchor => ({ kind: 'fixed', iso: new Date(y, m - 1, d).toISOString() })
const offset = (days: number): DateAnchor => ({ kind: 'offset', days })
const token = (t: (typeof RELATIVE_DATE_TOKENS)[number]): DateAnchor => ({ kind: 'relative', token: t })
const range = (start: DateAnchor | null, end: DateAnchor | null, extra: { not?: true; includeNoDate?: true } = {}) => ({ match: 'range' as const, start, end, ...extra })

const SHAPES: [string, DateField, DateFilters][] = [
  ['two dates (Calendar)', 'deadline', { deadline: range(fixed(2026, 10, 1), fixed(2026, 10, 31)) }],
  ['a date To alone', 'followup', { followup: range(null, fixed(2026, 11, 1)) }],
  ['a date far back (Created)', 'created', { created: range(fixed(2023, 1, 1), null) }],
  ['counts either way', 'deadline', { deadline: range(offset(-7), offset(14)) }],
  ['0 on each end', 'deadline', { deadline: range(offset(0), offset(0)) }],
  ['0 To alone', 'lastFollowup', { lastFollowup: range(null, offset(0)) }],
  ['999 days back', 'modified', { modified: range(offset(-999), null) }],
  ...RELATIVE_DATE_TOKENS.flatMap((t): [string, DateField, DateFilters][] => [
    [`From ${t}`, 'deadline', { deadline: range(token(t), null) }],
    [`To ${t}`, 'followup', { followup: range(null, token(t)) }],
  ]),
  ['a From holding end of week, a To holding start of week', 'created', { created: range(token('end-of-week'), token('start-of-week')) }],
  ['a mix: a date and a rolling day', 'deadline', { deadline: range(fixed(2026, 10, 1), token('today')) }],
  ['a mix: a count and a date', 'followup', { followup: range(offset(-7), fixed(2026, 12, 1)) }],
  ['is not', 'followup', { followup: range(token('today'), offset(14), { not: true }) }],
  ['is not, dates', 'lastFollowup', { lastFollowup: range(fixed(2026, 10, 1), fixed(2026, 10, 15), { not: true }) }],
  ['also tasks with no date', 'lastFollowup', { lastFollowup: range(null, offset(-14), { includeNoDate: true }) }],
  ['Any', 'deadline', { deadline: { match: 'set' } }],
  ['None', 'followup', { followup: { match: 'unset' } }],
  ['Completed', 'completed', { completed: range(token('start-of-week'), token('end-of-week')) }],
  ['Completed, dates', 'completed', { completed: range(fixed(2026, 10, 1), null) }],
  ['every type at once', 'deadline', {
    deadline: { match: 'set' },
    followup: range(offset(-3), fixed(2026, 11, 20)),
    lastFollowup: range(null, offset(-14), { includeNoDate: true }),
    completed: range(fixed(2026, 10, 1), fixed(2026, 10, 31)),
    created: range(offset(0), null),
    modified: range(token('yesterday'), token('tomorrow'), { not: true }),
  }],
]

/** Every menu in the open tab opened and closed with Esc; every box focused and left. */
function lookAround() {
  const panel = screen.getByRole('tabpanel')
  for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]'))) {
    fireEvent.click(button)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  }
  for (const box of Array.from(panel.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])'))) {
    fireEvent.focus(box)
    fireEvent.blur(box)
  }
}

describe('the date panel writes nothing while only looked at (P7–P8 review)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  for (const variant of ['popover', 'sheet'] as const) {
    for (const [name, field, dates] of SHAPES) {
      it(`${variant}: ${name}`, () => {
        const onChange = vi.fn()
        render(<DateFilterPanel dates={dates} initialField={field} variant={variant} onChange={onChange} />)
        lookAround()
        const tabs = screen.getAllByRole('tab')
        for (const t of tabs) {
          fireEvent.click(t)
          lookAround()
        }
        fireEvent.click(tabs.find((t) => t.id.endsWith(`-tab-${field}`)) ?? tabs[0]!)
        lookAround()
        expect(onChange).not.toHaveBeenCalled()
      })
    }
  }
})
