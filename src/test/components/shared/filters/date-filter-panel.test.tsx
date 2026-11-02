import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { DateField } from '../../../../models/app-view'
import type { DateFilters } from '../../../../models'
import { DateFilterPanel, type DateFilterHost } from '../../../../components/shared/filters/DateFilterPanel'

/**
 * The date panel: six type tabs in two rows of three (selected = being
 * edited, lit = filtering), a range per type, Show (In range · Has a date ·
 * No date) on Due / Next follow-up / Last follow-up, Completed a range only,
 * Clear <Type> and Clear all. Selecting a tab never writes.
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

describe('DateFilterPanel', () => {
  afterEach(cleanup)

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
    expect(screen.getByLabelText('From')).toHaveValue('')
    expect(screen.getByLabelText('To')).toHaveValue('')
  })

  it('setting a range lights its tab (accent + “filtering”); a second type adds its own clause', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    fireEvent.change(screen.getByLabelText('From (relative)'), { target: { value: 'today' } })
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: today, end: null } })
    expect(tab('Due, filtering')).toHaveAttribute('data-filtering')
    expect(within(screen.getByRole('tabpanel')).getByText('from today')).toBeInTheDocument()

    fireEvent.click(tab('Created'))
    expect(log).toHaveLength(1)
    expect(screen.getByLabelText('From (relative)')).toHaveValue('__none__')
    fireEvent.change(screen.getByLabelText('From (relative)'), { target: { value: 'start-of-week' } })
    expect(log.at(-1)).toEqual({
      deadline: { match: 'range', start: today, end: null },
      created: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: null },
    })
    expect(tab('Due, filtering')).toHaveAttribute('aria-selected', 'false')
    expect(tab('Created, filtering')).toHaveAttribute('aria-selected', 'true')
  })

  it('From and To offer short lists (Start of week / End of week); a preset fills the editable days field', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    const labels = (name: string) => Array.from((screen.getByLabelText(name) as HTMLSelectElement).options).map((o) => o.textContent)
    const offsets = ['1 week ago', '2 weeks ago', '1 month ago', 'In 1 week', 'In 2 weeks', 'In 1 month']
    expect(labels('From (relative)')).toEqual(['None', 'Today', 'Start of week', ...offsets, 'Custom offset…'])
    expect(labels('To (relative)')).toEqual(['None', 'Today', 'End of week', ...offsets, 'Custom offset…'])

    const to = screen.getByLabelText('To (relative)') as HTMLSelectElement
    const inTwoWeeks = Array.from(to.options).find((o) => o.textContent === 'In 2 weeks')
    fireEvent.change(to, { target: { value: inTwoWeeks?.value } })
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 14 } } })
    expect(screen.getByLabelText('To (days offset)')).toHaveValue('14')
    expect(within(screen.getByRole('tabpanel')).getByText('up to 14 days ahead')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('To (days offset)'), { target: { value: '10' } })
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 10 } } })
    expect(to.options[to.selectedIndex]?.textContent).toBe('Custom offset…')
  })

  it('Created / Modified have no Show control and no “also tasks with no …”', () => {
    render(<Harness log={[]} initialField="created" />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByText(/Also tasks with no/)).toBeNull()
  })

  it('Last follow-up: Show, “Also tasks never followed up”, its own words; Clear Last follow-up', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} initialField="lastFollowup" />)
    expect(within(screen.getByRole('tabpanel')).getByText('Last followed up')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('To (relative)'), { target: { value: 'today' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also tasks never followed up' }))
    expect(log.at(-1)).toEqual({ lastFollowup: { match: 'range', start: null, end: { kind: 'relative', token: 'today' }, includeNoDate: true } })
    expect(tab('Last follow-up, filtering')).toHaveAttribute('data-filtering')
    const group = screen.getByRole('radiogroup', { name: 'Which tasks' })
    fireEvent.click(within(group).getByRole('radio', { name: 'Has a date' }))
    expect(screen.getByText('Only tasks that have been followed up.')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('radio', { name: 'No date' }))
    expect(log.at(-1)).toEqual({ lastFollowup: { match: 'unset' } })
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

  it('an Eisenhower pane’s Completed range only keeps: its line says so', () => {
    render(<Harness log={[]} initialField="completed" host={{ completedNote: 'narrow' }} />)
    expect(screen.getByText('Keeps tasks completed in this range, of the tasks the Eisenhower’s list shows.')).toBeInTheDocument()
    expect(screen.queryByText(/even where completed tasks are hidden/)).toBeNull()
  })

  it('Completed is a range only, with a line saying it shows completed tasks', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} initialField="completed" />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Shows tasks completed in this range, even where completed tasks are hidden.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('From (relative)'), { target: { value: 'start-of-week' } })
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
    fireEvent.change(screen.getByLabelText('To (relative)'), { target: { value: 'end-of-week' } })
    expect(box).toBeEnabled()
    fireEvent.click(box)
    expect(log.at(-1)).toEqual({ followup: { match: 'range', start: null, end: { kind: 'relative', token: 'end-of-week' }, includeNoDate: true } })
    expect(within(screen.getByRole('tabpanel')).getByText('by end of week, or none')).toBeInTheDocument()
  })

  it('Show: Has a date / No date replace the range, hide From / To, and say what they keep', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    const group = screen.getByRole('radiogroup', { name: 'Which tasks' })
    expect(within(group).getByRole('radio', { name: 'In range' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(group).getByRole('radio', { name: 'Has a date' }))
    expect(log.at(-1)).toEqual({ deadline: { match: 'set' } })
    expect(screen.queryByLabelText('From')).toBeNull()
    expect(screen.getByText('Only tasks that have a due date.')).toBeInTheDocument()
    expect(tab('Due, filtering')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('radio', { name: 'No date' }))
    expect(log.at(-1)).toEqual({ deadline: { match: 'unset' } })
    expect(screen.getByText('Only tasks with no due date.')).toBeInTheDocument()
    // Back to In range with no range set: the type is off again.
    fireEvent.click(within(group).getByRole('radio', { name: 'In range' }))
    expect(log.at(-1)).toEqual({})
  })

  it('a range hidden by Has a date comes back with In range', () => {
    const log: DateFilters[] = []
    const range = { match: 'range' as const, start: today, end: { kind: 'offset' as const, days: 7 }, includeNoDate: true }
    render(<Harness log={log} initial={{ deadline: range }} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Has a date' }))
    expect(log.at(-1)).toEqual({ deadline: { match: 'set' } })
    fireEvent.click(screen.getByRole('radio', { name: 'In range' }))
    expect(log.at(-1)).toEqual({ deadline: range })
    expect(screen.getByRole('checkbox', { name: 'Also tasks with no due date' })).toBeChecked()
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
    fireEvent.keyDown(screen.getByRole('radio', { name: 'In range' }), { key: 'ArrowRight' })
    expect(log.at(-1)).toEqual({ deadline: { match: 'set' } })
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Has a date' }))
  })

  it('the phone sheet variant: a switch for no-date tasks and “Clear all dates”', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} variant="sheet" initial={{ deadline: { match: 'range', start: today, end: null } }} />)
    const sw = screen.getByRole('switch', { name: 'Also tasks with no due date' })
    fireEvent.click(sw)
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: today, end: null, includeNoDate: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all dates' }))
    expect(log.at(-1)).toEqual({})
  })
})
