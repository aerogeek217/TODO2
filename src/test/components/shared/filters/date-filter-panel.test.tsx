import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { DateField } from '../../../../models/app-view'
import type { DateFilters } from '../../../../models'
import { DateFilterPanel, type DateFilterHost } from '../../../../components/shared/filters/DateFilterPanel'

/**
 * The date panel: six type tabs in two rows of three (selected = being
 * edited, lit = filtering), a range per type, Show (Calendar · Relative, and
 * Any · None on Due / Next follow-up / Last follow-up — cr25 P8), Completed
 * a range only (no Is not), Clear <Type> and Clear all. Selecting a tab
 * never writes. Today is Mon 2 Nov 2026.
 */

function Harness({ initial = {}, initialField, variant, host, log }: {
  initial?: DateFilters
  initialField?: DateField
  variant?: 'popover' | 'sheet'
  host?: DateFilterHost
  log: DateFilters[]
}) {
  const [dates, setDates] = useState<DateFilters>(initial)
  return (
    <DateFilterPanel
      dates={dates}
      initialField={initialField}
      variant={variant}
      host={host}
      onChange={(next) => { log.push(next); setDates(next) }}
    />
  )
}

const tab = (name: RegExp | string) => screen.getByRole('tab', { name })
const today = { kind: 'relative' as const, token: 'today' as const }
const fixedIso = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString()

/** An end's Relative dropdown (`From: No start`, `To: days ago`, …). */
const relative = (end: 'From' | 'To') => screen.getByRole('button', { name: new RegExp(`^${end}: (?!Set to)`) })

/** Picks `item` (its label) from an end's Relative dropdown. */
function pickRelative(end: 'From' | 'To', item: string) {
  fireEvent.click(relative(end))
  const menu = screen.getByRole('menu', { name: end })
  const row = Array.from(menu.querySelectorAll<HTMLElement>('[data-menu-label]')).find((el) => el.dataset.menuLabel === item)
  if (!row) throw new Error(`no ${item} in ${end}`)
  fireEvent.click(row)
}

const show = (name: string) => within(screen.getByRole('radiogroup', { name: 'Which tasks' })).getByRole('radio', { name })

describe('DateFilterPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('opens on Due with nothing lit; the header says Not filtering and both clears are disabled', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    expect(screen.getByRole('tablist', { name: 'Date type' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Due', 'Next follow-up', 'Last follow-up', 'Completed', 'Created', 'Modified'])
    expect(tab('Due')).toHaveAttribute('aria-selected', 'true')
    for (const t of screen.getAllByRole('tab')) expect(t).not.toHaveAttribute('data-filtering')
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText('Due date')).toBeInTheDocument()
    expect(within(panel).getByText('Not filtering')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear Due' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
    expect(log).toEqual([])
  })

  it('opens on the first type that filters, or the type it is given', () => {
    const { unmount } = render(<Harness log={[]} initial={{ created: { match: 'range', start: today, end: null } }} />)
    expect(tab(/^Created/)).toHaveAttribute('aria-selected', 'true')
    unmount()
    render(<Harness log={[]} initial={{ created: { match: 'range', start: today, end: null } }} initialField="followup" />)
    expect(tab('Next follow-up')).toHaveAttribute('aria-selected', 'true')
  })

  it('selecting a tab writes nothing and lights nothing (no invented dates)', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    for (const name of ['Next follow-up', 'Last follow-up', 'Completed', 'Created', 'Modified', 'Due']) fireEvent.click(tab(name))
    expect(log).toEqual([])
    for (const t of screen.getAllByRole('tab')) expect(t).not.toHaveAttribute('data-filtering')
    expect(relative('From')).toHaveAccessibleName('From: No start')
    expect(relative('To')).toHaveAccessibleName('To: No end')
  })

  it('setting a range lights its tab (accent + “filtering”); a second type adds its own clause', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    pickRelative('From', 'today')
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: today, end: null } })
    expect(tab('Due, filtering')).toHaveAttribute('data-filtering')
    expect(within(screen.getByRole('tabpanel')).getByText('today or later')).toBeInTheDocument()

    fireEvent.click(tab('Created'))
    expect(log).toHaveLength(1)
    expect(relative('From')).toHaveAccessibleName('From: No start')
    pickRelative('From', 'start of week')
    expect(log.at(-1)).toEqual({
      deadline: { match: 'range', start: today, end: null },
      created: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: null },
    })
    expect(tab('Due, filtering')).toHaveAttribute('aria-selected', 'false')
    expect(tab('Created, filtering')).toHaveAttribute('aria-selected', 'true')
  })

  it('a new range is Relative: Fill in fills the number and the count, the number edits, its day today is under it', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    expect(show('Relative')).toHaveAttribute('aria-checked', 'true')
    pickRelative('To', 'In 2 weeks')
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 14 } } })
    expect(screen.getByLabelText('To: number of days')).toHaveValue('14')
    expect(relative('To')).toHaveAccessibleName('To: days ahead')
    expect(within(screen.getByRole('tabpanel')).getByText('in 14 days or earlier')).toBeInTheDocument()
    // The day under the end, read with its inputs.
    const line = screen.getByText('Mon 16 Nov and earlier')
    expect(screen.getByLabelText('To: number of days')).toHaveAccessibleDescription('Mon 16 Nov and earlier')
    expect(relative('To').getAttribute('aria-describedby')).toBe(line.id)

    fireEvent.change(screen.getByLabelText('To: number of days'), { target: { value: '10' } })
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 10 } } })
    expect(relative('To')).toHaveAccessibleName('To: days ahead')
    // With a From, each end its day alone.
    pickRelative('From', '1 week ago')
    expect(screen.getByText('10/26')).toBeInTheDocument()
    expect(screen.getByText('Thu 12 Nov')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/-\d|−/)
  })

  it('Calendar: the ends are dates with Set to…, no day line; a range of dates opens in Calendar', () => {
    const log: DateFilters[] = []
    const range = { match: 'range' as const, start: { kind: 'fixed' as const, iso: fixedIso(2026, 10, 1) }, end: { kind: 'fixed' as const, iso: fixedIso(2026, 10, 31) } }
    render(<Harness log={log} initial={{ deadline: range }} />)
    expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'From: Set to…' })).toBeInTheDocument()
    expect(screen.getByLabelText('To')).toHaveAttribute('type', 'date')
    expect(screen.queryByText(/and earlier|and later/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'To: Set to…' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^End of this month/ }))
    expect(log.at(-1)).toEqual({ deadline: { ...range, end: { kind: 'fixed', iso: fixedIso(2026, 11, 30) } } })
  })

  it('Calendar on an empty type: a typed date is stored as a date and the type stays in Calendar', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    fireEvent.click(show('Calendar'))
    expect(log).toEqual([])
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-05' } })
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: { kind: 'fixed', iso: new Date('2026-11-05T00:00:00').toISOString() }, end: null } })
    expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
  })

  it('switching modes converts the ends, and switching back restores them exactly while the panel is open', () => {
    const log: DateFilters[] = []
    const range = { match: 'range' as const, start: { kind: 'offset' as const, days: -7 }, end: { kind: 'relative' as const, token: 'end-of-week' as const }, includeNoDate: true as const }
    render(<Harness log={log} initialField="followup" initial={{ followup: range }} />)
    fireEvent.click(show('Calendar'))
    expect(log.at(-1)).toEqual({ followup: { ...range, start: { kind: 'fixed', iso: fixedIso(2026, 10, 26) }, end: { kind: 'fixed', iso: fixedIso(2026, 11, 8) } } })
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-26')
    fireEvent.click(show('Relative'))
    // Not `6 days ahead`: end of week, as it was.
    expect(log.at(-1)).toEqual({ followup: range })
    expect(relative('To')).toHaveAccessibleName('To: end of week')

    // An end edited in Calendar converts from its new date; the other end is still restored.
    fireEvent.click(show('Calendar'))
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-09' } })
    fireEvent.click(show('Relative'))
    expect(log.at(-1)).toEqual({ followup: { ...range, end: { kind: 'offset', days: 7 } } })
  })

  it('to Relative, a date more than 999 days away stays a date: its own choice, as in a saved mix (P7–P8 review)', () => {
    const log: DateFilters[] = []
    const jan1 = { kind: 'fixed' as const, iso: fixedIso(2023, 1, 1) }
    render(<Harness log={log} initialField="created" initial={{ created: { match: 'range', start: jan1, end: null } }} />)
    expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(show('Relative'))
    expect(log.at(-1)).toEqual({ created: { match: 'range', start: jan1, end: null } })
    expect(show('Relative')).toHaveAttribute('aria-checked', 'true')
    expect(relative('From')).toHaveAccessibleName('From: on Jan 1')
    expect(screen.queryByLabelText('From: number of days')).toBeNull()
  })

  it('a saved mix (a date and today) opens in Relative with the date as its own choice', () => {
    render(<Harness log={[]} initial={{ deadline: { match: 'range', start: { kind: 'fixed', iso: fixedIso(2026, 10, 1) }, end: today } }} />)
    expect(show('Relative')).toHaveAttribute('aria-checked', 'true')
    expect(relative('From')).toHaveAccessibleName('From: on Oct 1')
    expect(relative('To')).toHaveAccessibleName('To: today')
    expect(screen.getByText('10/01')).toBeInTheDocument()
  })

  describe('the mode shown stays for the panel’s life (P7–P8 review)', () => {
    const oct31 = { kind: 'fixed' as const, iso: fixedIso(2026, 10, 31) }

    it('a saved Calendar range keeps Calendar when its only date is emptied: the date input stays', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initial={{ deadline: { match: 'range', start: null, end: oct31 } }} />)
      expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
      const input = screen.getByLabelText('To')
      fireEvent.change(input, { target: { value: '' } })
      expect(log.at(-1)).toEqual({})
      expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
      // The same element: never unmounted under the user's typing.
      expect(screen.getByLabelText('To')).toBe(input)
      fireEvent.change(input, { target: { value: '2026-11-05' } })
      expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'fixed', iso: fixedIso(2026, 11, 5) } } })
    })

    it('…and when Set to… › Clear the date clears it, or both dates are cleared', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initial={{ deadline: { match: 'range', start: { kind: 'fixed', iso: fixedIso(2026, 10, 1) }, end: oct31 } }} />)
      fireEvent.click(screen.getByRole('button', { name: 'To: Set to…' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Clear the date' }))
      expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } })
      expect(log.at(-1)).toEqual({})
      expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date')
    })

    it('a saved mix opened in Relative stays Relative when No end leaves only its date', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initial={{ deadline: { match: 'range', start: { kind: 'fixed', iso: fixedIso(2026, 10, 1) }, end: today } }} />)
      expect(show('Relative')).toHaveAttribute('aria-checked', 'true')
      pickRelative('To', 'No end')
      expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: { kind: 'fixed', iso: fixedIso(2026, 10, 1) }, end: null } })
      expect(show('Relative')).toHaveAttribute('aria-checked', 'true')
      expect(relative('From')).toHaveAccessibleName('From: on Oct 1')
    })

    it('another tab and back keeps it; Clear <Type> puts it back to Relative (a new range)', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initial={{ deadline: { match: 'range', start: null, end: oct31 } }} />)
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '' } })
      fireEvent.click(tab('Created'))
      fireEvent.click(tab('Due'))
      expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-05' } })
      fireEvent.click(screen.getByRole('button', { name: 'Clear Due' }))
      expect(show('Relative')).toHaveAttribute('aria-checked', 'true')
    })
  })

  describe('0 days keeps its count while the panel is open (P7–P8 review)', () => {
    it('another tab and back: still days ahead, and a typed number counts ahead', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} />)
      pickRelative('To', 'days ahead')
      expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 0 } } })
      expect(relative('To')).toHaveAccessibleName('To: days ahead')
      fireEvent.click(tab('Created'))
      fireEvent.click(tab('Due, filtering'))
      expect(relative('To')).toHaveAccessibleName('To: days ahead')
      fireEvent.change(screen.getByLabelText('To: number of days'), { target: { value: '5' } })
      expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 5 } } })
    })

    it('Calendar and back: still days ahead; each end keeps its own', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} />)
      pickRelative('To', 'days ahead')
      pickRelative('From', 'days ago')
      fireEvent.click(show('Calendar'))
      fireEvent.click(show('Relative'))
      expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: { kind: 'offset', days: 0 }, end: { kind: 'offset', days: 0 } } })
      expect(relative('To')).toHaveAccessibleName('To: days ahead')
      expect(relative('From')).toHaveAccessibleName('From: days ago')
    })

    it('with nothing picked, a saved 0 reads days ago', () => {
      render(<Harness log={[]} initial={{ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 0 } } }} />)
      expect(relative('To')).toHaveAccessibleName('To: days ago')
    })
  })

  it('Created / Modified: Show is Calendar · Relative only, and no “also tasks with no …”', () => {
    render(<Harness log={[]} initialField="created" />)
    const group = screen.getByRole('radiogroup', { name: 'Which tasks' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Calendar', 'Relative'])
    expect(screen.queryByText(/Also tasks with no/)).toBeNull()
    // Its range has Is / Is not, as every type but Completed.
    expect(screen.getByRole('radiogroup', { name: 'Created: is or is not' })).toBeInTheDocument()
  })

  it('Last follow-up: Show, “Also tasks never followed up”, its own words; Clear Last follow-up', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} initialField="lastFollowup" />)
    expect(within(screen.getByRole('tabpanel')).getByText('Last followed up')).toBeInTheDocument()
    pickRelative('To', 'today')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also tasks never followed up' }))
    expect(log.at(-1)).toEqual({ lastFollowup: { match: 'range', start: null, end: { kind: 'relative', token: 'today' }, includeNoDate: true } })
    expect(tab('Last follow-up, filtering')).toHaveAttribute('data-filtering')
    const group = screen.getByRole('radiogroup', { name: 'Which tasks' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Calendar', 'Relative', 'Any', 'None'])
    fireEvent.click(within(group).getByRole('radio', { name: 'Any' }))
    expect(screen.getByText('Only tasks that have been followed up.')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByText('any date')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('radio', { name: 'None' }))
    expect(log.at(-1)).toEqual({ lastFollowup: { match: 'unset' } })
    expect(within(screen.getByRole('tabpanel')).getByText('never')).toBeInTheDocument()
    expect(screen.getByText('Only tasks never followed up.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear Last follow-up' }))
    expect(log.at(-1)).toEqual({})
  })

  it('a host can leave Completed out (the check-in): five tabs, ↑/↓ to the shorter row’s last tab', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} initialField="completed" host={{ omit: ['completed'] }} />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Due', 'Next follow-up', 'Last follow-up', 'Created', 'Modified'])
    // An omitted initial type opens on the first offered one.
    expect(tab('Due')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab('Due'), { key: 'End' })
    expect(tab('Modified')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab('Modified'), { key: 'ArrowRight' })
    expect(tab('Due')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab('Due'), { key: 'ArrowLeft' })
    fireEvent.keyDown(tab('Modified'), { key: 'ArrowLeft' })
    fireEvent.keyDown(tab('Created'), { key: 'ArrowLeft' })
    expect(tab('Last follow-up')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab('Last follow-up'), { key: 'ArrowDown' })
    expect(tab('Modified')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab('Modified'), { key: 'ArrowUp' })
    expect(tab('Next follow-up')).toHaveAttribute('aria-selected', 'true')
    expect(log).toEqual([])
  })

  it('Completed is a range only (Calendar · Relative, no Is not), with a line saying it shows completed tasks', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} initialField="completed" />)
    expect(screen.getAllByRole('radiogroup').map((g) => g.getAttribute('aria-label'))).toEqual(['Which tasks'])
    expect(within(screen.getByRole('radiogroup')).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Calendar', 'Relative'])
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Shows tasks completed in this range, even where completed tasks are hidden.')).toBeInTheDocument()
    pickRelative('From', 'start of week')
    expect(log.at(-1)).toEqual({ completed: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: null } })
    expect(tab('Completed, filtering')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Clear Completed' })).toBeEnabled()
  })

  it('“Also tasks with no next follow-up” is disabled until an end is set, then adds no-date tasks', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} initialField="followup" />)
    const box = screen.getByRole('checkbox', { name: 'Also tasks with no next follow-up' })
    expect(box).toBeDisabled()
    fireEvent.click(box)
    expect(log).toEqual([])
    pickRelative('To', 'end of week')
    expect(box).toBeEnabled()
    fireEvent.click(box)
    expect(log.at(-1)).toEqual({ followup: { match: 'range', start: null, end: { kind: 'relative', token: 'end-of-week' }, includeNoDate: true } })
    expect(within(screen.getByRole('tabpanel')).getByText('on or before end of week, or none')).toBeInTheDocument()
  })

  it('Show: Any / None replace the range, hide From / To, and say what they keep', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    const group = screen.getByRole('radiogroup', { name: 'Which tasks' })
    expect(within(group).getByRole('radio', { name: 'Relative' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(group).getByRole('radio', { name: 'Any' }))
    expect(log.at(-1)).toEqual({ deadline: { match: 'set' } })
    expect(screen.queryByRole('button', { name: /^From/ })).toBeNull()
    expect(screen.getByText('Only tasks that have a due date.')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByText('any date')).toBeInTheDocument()
    expect(tab('Due, filtering')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('radio', { name: 'None' }))
    expect(log.at(-1)).toEqual({ deadline: { match: 'unset' } })
    expect(screen.getByText('Only tasks with no due date.')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByText('none')).toBeInTheDocument()
    // Back to a range with none set: the type is off again.
    fireEvent.click(within(group).getByRole('radio', { name: 'Relative' }))
    expect(log.at(-1)).toEqual({})
  })

  it('a range hidden by Any comes back in its mode, or converted to the other', () => {
    const log: DateFilters[] = []
    const range = { match: 'range' as const, start: today, end: { kind: 'offset' as const, days: 7 }, includeNoDate: true }
    render(<Harness log={log} initial={{ deadline: range }} />)
    fireEvent.click(show('Any'))
    expect(log.at(-1)).toEqual({ deadline: { match: 'set' } })
    fireEvent.click(show('Relative'))
    expect(log.at(-1)).toEqual({ deadline: range })
    expect(screen.getByRole('checkbox', { name: 'Also tasks with no due date' })).toBeChecked()
    fireEvent.click(show('None'))
    fireEvent.click(show('Calendar'))
    expect(log.at(-1)).toEqual({ deadline: { ...range, start: { kind: 'fixed', iso: fixedIso(2026, 11, 2) }, end: { kind: 'fixed', iso: fixedIso(2026, 11, 9) } } })
    // And back to Relative: as it was.
    fireEvent.click(show('Relative'))
    expect(log.at(-1)).toEqual({ deadline: range })
  })

  it('Clear <Type> forgets a picked mode: the empty type is Relative again', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    fireEvent.click(show('Calendar'))
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear Due' }))
    expect(log.at(-1)).toEqual({})
    expect(show('Relative')).toHaveAttribute('aria-checked', 'true')
  })

  it('Clear <Type> resets only the selected type; Clear all resets every type; neither closes', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} initial={{ deadline: { match: 'set' }, created: { match: 'range', start: today, end: null } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear Due' }))
    expect(log.at(-1)).toEqual({ created: { match: 'range', start: today, end: null } })
    expect(screen.getByRole('button', { name: 'Clear Due' })).toBeDisabled()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    fireEvent.click(tab(/^Created/))
    expect(screen.getByRole('button', { name: 'Clear Created' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(log.at(-1)).toEqual({})
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
  })

  it('arrow keys, Home and End move between tabs (roving tabindex) without writing', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    const due = tab('Due')
    expect(due).toHaveAttribute('tabindex', '0')
    expect(tab('Created')).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(due, { key: 'ArrowRight' })
    expect(tab('Next follow-up')).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(tab('Next follow-up'))
    fireEvent.keyDown(tab('Next follow-up'), { key: 'End' })
    expect(document.activeElement).toBe(tab('Modified'))
    fireEvent.keyDown(tab('Modified'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('Due'))
    fireEvent.keyDown(tab('Due'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tab('Modified'))
    fireEvent.keyDown(tab('Modified'), { key: 'Home' })
    expect(document.activeElement).toBe(tab('Due'))
    expect(log).toEqual([])
  })

  it('Up / Down move between the two rows in the same column', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} initialField="followup" />)
    fireEvent.keyDown(tab('Next follow-up'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tab('Created'))
    expect(tab('Created')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab('Created'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tab('Next follow-up'))
    fireEvent.keyDown(tab('Next follow-up'), { key: 'ArrowRight' })
    fireEvent.keyDown(tab('Last follow-up'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(tab('Modified'))
    fireEvent.keyDown(tab('Modified'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(tab('Last follow-up'))
    // Right from the end of the first row goes on to the second, in reading order.
    fireEvent.keyDown(tab('Last follow-up'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('Completed'))
    expect(log).toEqual([])
  })

  it('arrow keys move the Show choice', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    expect(show('Relative')).toHaveAttribute('tabindex', '0')
    expect(show('Calendar')).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(show('Relative'), { key: 'ArrowRight' })
    expect(log.at(-1)).toEqual({ deadline: { match: 'set' } })
    expect(document.activeElement).toBe(show('Any'))
    fireEvent.keyDown(show('Any'), { key: 'ArrowRight' })
    fireEvent.keyDown(show('None'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(show('Calendar'))
    expect(log.at(-1)).toEqual({})
  })

  it('Home / End move the Show choice to the first / last, as the tabs (P7–P8 review)', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    fireEvent.keyDown(show('Relative'), { key: 'End' })
    expect(log.at(-1)).toEqual({ deadline: { match: 'unset' } })
    expect(document.activeElement).toBe(show('None'))
    fireEvent.keyDown(show('None'), { key: 'Home' })
    expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
    expect(document.activeElement).toBe(show('Calendar'))
    // Created's two choices.
    fireEvent.click(tab('Created'))
    fireEvent.keyDown(show('Relative'), { key: 'Home' })
    expect(document.activeElement).toBe(show('Calendar'))
    fireEvent.keyDown(show('Calendar'), { key: 'End' })
    expect(document.activeElement).toBe(show('Relative'))
  })

  describe('Is / Is not on the range (cr25 P4)', () => {
    const isNot = (name: string) => within(screen.getByRole('radiogroup', { name: `${name}: is or is not` })).getByRole('radio', { name: 'Is not' })
    const is = (name: string) => within(screen.getByRole('radiogroup', { name: `${name}: is or is not` })).getByRole('radio', { name: 'Is' })

    it('Is not before an end writes nothing, then the end writes a negated range; the no-date box gives way to a line', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initialField="followup" />)
      expect(is('Next follow-up')).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(isNot('Next follow-up'))
      expect(log).toEqual([])
      expect(isNot('Next follow-up')).toHaveAttribute('aria-checked', 'true')
      expect(screen.queryByRole('checkbox')).toBeNull()
      expect(screen.getByText('Tasks with no next follow-up are kept.')).toBeInTheDocument()
      pickRelative('From', 'today')
      pickRelative('To', 'In 2 weeks')
      expect(log.at(-1)).toEqual({ followup: { match: 'range', start: today, end: { kind: 'offset', days: 14 }, not: true } })
      expect(within(screen.getByRole('tabpanel')).getByText('not within the next 14 days')).toBeInTheDocument()
      // Back to Is: the same range, the box back (unticked).
      fireEvent.click(is('Next follow-up'))
      expect(log.at(-1)).toEqual({ followup: { match: 'range', start: today, end: { kind: 'offset', days: 14 } } })
      expect(screen.getByRole('checkbox', { name: 'Also tasks with no next follow-up' })).not.toBeChecked()
    })

    it('Is not drops “also tasks with no …” (it keeps them anyway)', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initial={{ deadline: { match: 'range', start: null, end: today, includeNoDate: true } }} />)
      fireEvent.click(isNot('Due'))
      expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: today, not: true } })
      expect(screen.getByText('Tasks with no due date are kept.')).toBeInTheDocument()
    })

    it('Any and back to Relative keeps the Is not', () => {
      const log: DateFilters[] = []
      const range = { match: 'range' as const, start: { kind: 'offset' as const, days: -7 }, end: today, not: true as const }
      render(<Harness log={log} initialField="lastFollowup" initial={{ lastFollowup: range }} />)
      expect(screen.getByText('Tasks never followed up are kept.')).toBeInTheDocument()
      fireEvent.click(show('Any'))
      expect(screen.queryByRole('radiogroup', { name: 'Last follow-up: is or is not' })).toBeNull()
      fireEvent.click(show('Relative'))
      expect(log.at(-1)).toEqual({ lastFollowup: range })
    })

    it('Created: Is not with no line (every task has the date); Completed has none', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initialField="created" initial={{ created: { match: 'range', start: { kind: 'offset', days: -7 }, end: null } }} />)
      fireEvent.click(isNot('Created'))
      expect(log.at(-1)).toEqual({ created: { match: 'range', start: { kind: 'offset', days: -7 }, end: null, not: true } })
      expect(screen.queryByText(/are kept/)).toBeNull()
      fireEvent.click(tab('Completed'))
      expect(screen.queryByRole('radiogroup', { name: 'Completed: is or is not' })).toBeNull()
    })

    it('a pending Is not is per type: another tab and Clear <Type> leave it; clearing a range keeps its Is not pending', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initialField="deadline" initial={{ created: { match: 'range', start: null, end: today } }} />)
      fireEvent.click(isNot('Due'))
      fireEvent.click(tab('Created, filtering'))
      expect(is('Created')).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'Clear Created' }))
      fireEvent.click(tab('Due'))
      expect(isNot('Due')).toHaveAttribute('aria-checked', 'true')
      pickRelative('To', 'today')
      expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: today, not: true } })
      // To back to No end: no clause, the switch stays Is not for the next end.
      pickRelative('To', 'No end')
      expect(log.at(-1)).toEqual({})
      expect(isNot('Due')).toHaveAttribute('aria-checked', 'true')
    })

    it('the phone sheet: the touch toggle', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} variant="sheet" initial={{ deadline: { match: 'range', start: today, end: null } }} />)
      fireEvent.click(isNot('Due'))
      expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: today, end: null, not: true } })
      expect(screen.queryByRole('switch')).toBeNull()
      expect(screen.getByText('Tasks with no due date are kept.')).toBeInTheDocument()
    })
  })

  it('the phone sheet variant: the four Show choices, a switch for no-date tasks and “Clear all dates”', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} variant="sheet" initial={{ deadline: { match: 'range', start: today, end: null } }} />)
    expect(within(screen.getByRole('radiogroup', { name: 'Which tasks' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Calendar', 'Relative', 'Any', 'None'])
    expect(screen.getByText('Mon 2 Nov and later')).toBeInTheDocument()
    const sw = screen.getByRole('switch', { name: 'Also tasks with no due date' })
    fireEvent.click(sw)
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: today, end: null, includeNoDate: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all dates' }))
    expect(log.at(-1)).toEqual({})
  })
})
