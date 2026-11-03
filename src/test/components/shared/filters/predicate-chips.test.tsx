import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { PredicateChips } from '../../../../components/shared/filters/PredicateChips'
import { TOOLTIP_DELAY_MS } from '../../../../components/shared/use-tooltip'
import { emptyPredicate, type TodoPredicate } from '../../../../models'

/** A list's own filter chips: one chip per date type, × clears only its type, a click opens the panel on it. */

function Harness({ initial, log }: { initial: TodoPredicate; log: TodoPredicate[] }) {
  const [p, setP] = useState(initial)
  return <PredicateChips predicate={p} onChange={(next) => { log.push(next); setP(next) }} />
}

const startOfMonth = { kind: 'relative' as const, token: 'start-of-month' as const }
const twoDates: TodoPredicate = {
  ...emptyPredicate(),
  dates: {
    deadline: { match: 'range', start: { kind: 'offset', days: 0 }, end: { kind: 'offset', days: 7 } },
    created: { match: 'range', start: startOfMonth, end: null },
  },
}

describe('PredicateChips — date chips', () => {
  afterEach(cleanup)

  it('shows one chip per date type that filters, in tab order', () => {
    render(<Harness initial={twoDates} log={[]} />)
    const chips = screen.getAllByTestId('list-filter-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['Duewithin the next 7 days', 'Createdon or after start of month'])
  })

  it('a date chip’s tooltip spells its exact days, resolved against today (cr25 P7)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    // Mon 2 Nov 2026, weeks starting Monday (the default).
    vi.setSystemTime(new Date(2026, 10, 2, 10))
    try {
      render(<Harness initial={twoDates} log={[]} />)
      const [due] = screen.getAllByTestId('list-filter-chip')
      fireEvent.pointerEnter(due!, { pointerType: 'mouse' })
      act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
      expect(screen.getByRole('tooltip')).toHaveTextContent('Due: within the next 7 daysDue from Mon 2 Nov through Mon 9 Nov')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a chip’s × clears only its date type', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={twoDates} log={log} />)
    const [due] = screen.getAllByTestId('list-filter-chip')
    fireEvent.click(within(due!).getByRole('button', { name: 'Remove filter' }))
    expect(log.at(-1)?.dates).toEqual({ created: { match: 'range', start: startOfMonth, end: null } })
    expect(screen.getAllByTestId('list-filter-chip').map((c) => c.textContent)).toEqual(['Createdon or after start of month'])
  })

  it('clicking a chip opens the date panel on that chip’s type, and shows the chip open', () => {
    render(<Harness initial={twoDates} log={[]} />)
    const created = screen.getAllByTestId('list-filter-chip')[1]!
    fireEvent.click(created)
    const dialog = screen.getByRole('dialog', { name: 'Date filters' })
    expect(within(dialog).getByRole('tab', { name: 'Created, filtering' })).toHaveAttribute('aria-selected', 'true')
    expect(created).toHaveAttribute('aria-expanded', 'true')
  })

  it('+ Filter › Dates opens the panel on the first type that doesn’t filter yet, so it adds a chip (cr25 P4b)', () => {
    const log: TodoPredicate[] = []
    const { unmount } = render(<Harness initial={{ ...emptyPredicate(), dates: { deadline: { match: 'set' } } }} log={log} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dates' }))
    const dialog = screen.getByRole('dialog', { name: 'Date filters' })
    expect(within(dialog).getByRole('tab', { name: 'Next follow-up' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Any' }))
    expect(log.at(-1)?.dates).toEqual({ deadline: { match: 'set' }, followup: { match: 'set' } })
    expect(screen.getAllByTestId('list-filter-chip').map((c) => c.getAttribute('data-date-field'))).toEqual(['deadline', 'followup'])
    unmount()
    render(<Harness initial={emptyPredicate()} log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.queryByRole('menuitem', { name: /Due date|follow-up date/i })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dates' }))
    expect(within(screen.getByRole('dialog', { name: 'Date filters' })).getByRole('tab', { name: 'Due' }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('+ Filter › Dates with every type filtering opens on the first that filters (the panel’s default)', () => {
    const set = { match: 'set' as const }
    const end = { match: 'range' as const, start: null, end: { kind: 'offset' as const, days: 0 } }
    render(<Harness initial={{ ...emptyPredicate(), dates: { deadline: set, followup: set, lastFollowup: set, completed: end, created: end, modified: end } }} log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dates' }))
    expect(within(screen.getByRole('dialog', { name: 'Date filters' })).getByRole('tab', { name: 'Due, filtering' }))
      .toHaveAttribute('aria-selected', 'true')
  })
})

describe('PredicateChips — a field picker’s search', () => {
  afterEach(cleanup)

  it('the first Esc empties the search, the next closes the picker', () => {
    render(<Harness initial={emptyPredicate()} log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tags' }))
    const search = screen.getByPlaceholderText('Search...') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'q4' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search.value).toBe('')
    expect(screen.getByPlaceholderText('Search...')).toBe(search)
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('Search...')).toBeNull()
  })
})
