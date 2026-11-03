import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DateAnchorInput } from '../../components/shared/DateAnchorInput'
import type { DateAnchor } from '../../models'
import type { DateAnchorSide, DateEntryMode } from '../../utils/date-anchor'

/**
 * One end of a date range (cr25 P8, D23 boards B / C). Calendar: a date
 * input and a Set to… action menu (each item with its day today) that fills
 * a fixed date. Relative: a number box (digits only) + a dropdown saying
 * what it counts — never the number — with Count / Fill in / Rolling day /
 * No end; a saved mix's date and a token the lists no longer offer show
 * while they are the value.
 */

afterEach(cleanup)

const DAY = { today: new Date(2026, 10, 2), weekStartsOn: 1 as const } // Mon 2 Nov 2026
const fixedIso = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString()

function Harness({ mode, side, initial = null, log, describedBy }: {
  mode: DateEntryMode
  side: DateAnchorSide
  initial?: DateAnchor | null
  log: (DateAnchor | null)[]
  describedBy?: string
}) {
  const [value, setValue] = useState<DateAnchor | null>(initial)
  const label = side === 'from' ? 'From' : 'To'
  return (
    <DateAnchorInput
      mode={mode}
      side={side}
      value={value}
      label={label}
      day={DAY}
      describedBy={describedBy}
      onChange={(v) => { log.push(v); setValue(v) }}
    />
  )
}

/** A menu's rows: `label` or `label · note`, separators as `—`, group labels as `[Label]`, a checked row with `✓`. */
function menuRows(name: string): string[] {
  const menu = screen.getByRole('menu', { name })
  return Array.from(menu.children).map((el) => {
    if (el.getAttribute('role') === 'separator') return '—'
    const label = (el as HTMLElement).dataset.menuLabel
    if (label === undefined) return `[${el.textContent}]`
    const note = el.textContent?.slice(label.length) ?? ''
    return `${label}${note ? ` · ${note}` : ''}${el.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`
  })
}

describe('DateAnchorInput: Calendar', () => {
  it('a date input and a Set to… button; no number, no relative dropdown', () => {
    render(<Harness mode="calendar" side="from" initial={{ kind: 'fixed', iso: '2026-04-18T12:00:00.000Z' }} log={[]} />)
    expect(screen.getByLabelText('From')).toHaveValue('2026-04-18')
    expect(screen.getByRole('button', { name: 'From: Set to…' })).toHaveTextContent('Set to…')
    expect(screen.queryByLabelText('From: number of days')).toBeNull()
  })

  it('shows the date’s local day, not its UTC one (P7–P8 review)', () => {
    // Show Overdue Tasks stores yesterday 23:59:59.999 local: west of UTC its ISO is already today.
    render(<Harness mode="calendar" side="to" initial={{ kind: 'fixed', iso: new Date(2026, 10, 1, 23, 59, 59, 999).toISOString() }} log={[]} />)
    expect(screen.getByLabelText('To')).toHaveValue('2026-11-01')
    cleanup()
    // A typed date's local midnight: east of UTC its ISO is still the day before.
    render(<Harness mode="calendar" side="from" initial={{ kind: 'fixed', iso: new Date(2026, 10, 1).toISOString() }} log={[]} />)
    expect(screen.getByLabelText('From')).toHaveValue('2026-11-01')
  })

  it('typing a date stores it as a fixed date; emptying clears the end', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="calendar" side="to" log={log} />)
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-04-20' } })
    expect(log.at(-1)).toEqual({ kind: 'fixed', iso: new Date('2026-04-20T00:00:00').toISOString() })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '' } })
    expect(log.at(-1)).toBeNull()
  })

  it('To’s Set to… lists the ends and future days with their day today, then Clear the date (off while empty)', () => {
    render(<Harness mode="calendar" side="to" log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: Set to…' }))
    expect(menuRows('Set To to')).toEqual([
      'Today · Mon 2 Nov', 'End of this week · Sun 8 Nov', 'End of this month · Mon 30 Nov', 'End of next month · Thu 31 Dec',
      '—', 'In 1 week · Mon 9 Nov', 'In 2 weeks · Mon 16 Nov', 'In 1 month · Wed 2 Dec',
      '—', 'Clear the date',
    ])
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Clear the date' })).toBeDisabled()
  })

  it('From’s Set to… lists the starts and past days', () => {
    render(<Harness mode="calendar" side="from" log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'From: Set to…' }))
    expect(menuRows('Set From to')).toEqual([
      'Today · Mon 2 Nov', 'Start of this week · Mon 2 Nov', 'Start of this month · Sun 1 Nov', 'Start of last month · Thu 1 Oct',
      '—', '1 week ago · Mon 26 Oct', '2 weeks ago · Mon 19 Oct', '1 month ago · Sat 3 Oct',
      '—', 'Clear the date',
    ])
  })

  it('a Set to… item fills the date (a fixed date, never a rolling one) and the button reads Set to… again; Clear the date clears', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="calendar" side="to" log={log} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: Set to…' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^End of this month/ }))
    expect(log.at(-1)).toEqual({ kind: 'fixed', iso: fixedIso(2026, 11, 30) })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'To: Set to…' })).toHaveTextContent('Set to…')
    fireEvent.click(screen.getByRole('button', { name: 'To: Set to…' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear the date' }))
    expect(log.at(-1)).toBeNull()
  })
})

describe('DateAnchorInput: Relative', () => {
  it('no end: the dropdown reads No start / No end and there is no number', () => {
    render(<Harness mode="relative" side="from" log={[]} />)
    expect(screen.getByRole('button', { name: 'From: No start' })).toHaveTextContent('No start')
    expect(screen.queryByLabelText('From: number of days')).toBeNull()
    cleanup()
    render(<Harness mode="relative" side="to" log={[]} />)
    expect(screen.getByRole('button', { name: 'To: No end' })).toBeInTheDocument()
  })

  it('a count: the number unsigned, the dropdown says what it counts and never repeats the number', () => {
    render(<Harness mode="relative" side="to" initial={{ kind: 'offset', days: -7 }} log={[]} describedBy="day-line" />)
    expect(screen.getByLabelText('To: number of days')).toHaveValue('7')
    const dropdown = screen.getByRole('button', { name: 'To: days ago' })
    expect(dropdown).toHaveTextContent(/^days ago$/)
    expect(dropdown).toHaveAttribute('aria-haspopup', 'menu')
    // Both read the day line under the end.
    expect(screen.getByLabelText('To: number of days')).toHaveAttribute('aria-describedby', 'day-line')
    expect(dropdown).toHaveAttribute('aria-describedby', 'day-line')
    expect(document.body.textContent).not.toMatch(/-\s*\d|−/)
  })

  it('one day reads in the singular', () => {
    render(<Harness mode="relative" side="to" initial={{ kind: 'offset', days: 1 }} log={[]} />)
    expect(screen.getByRole('button', { name: 'To: day ahead' })).toBeInTheDocument()
  })

  it('the number takes digits only, at most three; a cleared box holds until blur', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" initial={{ kind: 'offset', days: 14 }} log={log} />)
    const box = screen.getByLabelText('To: number of days')
    expect(box).toHaveAttribute('inputmode', 'numeric')
    expect(box).toHaveAttribute('maxlength', '3')
    fireEvent.change(box, { target: { value: '21' } })
    expect(log.at(-1)).toEqual({ kind: 'offset', days: 21 })
    for (const bad of ['-2', '2a', '1.5', '1000']) fireEvent.change(box, { target: { value: bad } })
    expect(log).toHaveLength(1)
    expect(box).toHaveValue('21')
    fireEvent.change(box, { target: { value: '' } })
    expect(box).toHaveValue('')
    expect(log).toHaveLength(1)
    fireEvent.blur(box)
    expect(box).toHaveValue('21')
  })

  it('the dropdown: Count, Fill in (with the number each fills), Rolling day for the end, then No end', () => {
    render(<Harness mode="relative" side="to" initial={{ kind: 'offset', days: -7 }} log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: days ago' }))
    expect(menuRows('To')).toEqual([
      '[Count]', 'days ago ✓', 'days ahead',
      '—', '[Fill in]', '1 week ago · 7', '2 weeks ago · 14', '1 month ago · 30', 'In 1 week · 7', 'In 2 weeks · 14', 'In 1 month · 30',
      '—', '[Rolling day]', 'today', 'end of week', 'end of month',
      '—', 'No end',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: /^In 2 weeks/ }))
  })

  it('From’s rolling days are starts', () => {
    render(<Harness mode="relative" side="from" log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'From: No start' }))
    const rows = menuRows('From')
    expect(rows.slice(rows.indexOf('[Rolling day]'))).toEqual(['[Rolling day]', 'today', 'start of week', 'start of month', '—', 'No start ✓'])
  })

  it('Fill in fills the number and the count, then the dropdown reads the count', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" log={log} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: No end' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^1 week ago/ }))
    expect(log.at(-1)).toEqual({ kind: 'offset', days: -7 })
    expect(screen.getByLabelText('To: number of days')).toHaveValue('7')
    expect(screen.getByRole('button', { name: 'To: days ago' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'To: days ago' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^In 1 month/ }))
    expect(log.at(-1)).toEqual({ kind: 'offset', days: 30 })
    expect(screen.getByLabelText('To: number of days')).toHaveValue('30')
    expect(screen.getByRole('button', { name: 'To: days ahead' })).toBeInTheDocument()
  })

  it('a count keeps the number and turns it round; picking one moves the focus to the number', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" initial={{ kind: 'offset', days: -7 }} log={log} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: days ago' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'days ahead' }))
    expect(log.at(-1)).toEqual({ kind: 'offset', days: 7 })
    expect(screen.getByLabelText('To: number of days')).toHaveFocus()
  })

  it('a count from a rolling day starts at that day’s distance when it lies that way, else 0', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" initial={{ kind: 'relative', token: 'end-of-week' }} log={log} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: end of week' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'days ahead' }))
    expect(log.at(-1)).toEqual({ kind: 'offset', days: 6 }) // Sun 8 Nov
    cleanup()
    const log2: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" log={log2} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: No end' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'days ago' }))
    expect(log2.at(-1)).toEqual({ kind: 'offset', days: 0 })
    expect(screen.getByLabelText('To: number of days')).toHaveValue('0')
  })

  it('0 keeps the count it was typed under', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" initial={{ kind: 'offset', days: 5 }} log={log} />)
    fireEvent.change(screen.getByLabelText('To: number of days'), { target: { value: '0' } })
    expect(log.at(-1)).toEqual({ kind: 'offset', days: 0 })
    expect(screen.getByRole('button', { name: 'To: days ahead' })).toBeInTheDocument()
  })

  it('a rolling day hides the number; No end clears', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" initial={{ kind: 'offset', days: -7 }} log={log} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: days ago' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'end of month' }))
    expect(log.at(-1)).toEqual({ kind: 'relative', token: 'end-of-month' })
    expect(screen.queryByLabelText('To: number of days')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'To: end of month' }))
    expect(menuRows('To')).toContain('end of month ✓')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'No end' }))
    expect(log.at(-1)).toBeNull()
  })

  it('a token the lists no longer offer is the value, listed under Rolling day only while it is', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" initial={{ kind: 'relative', token: 'end-of-next-month' }} log={log} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: end of next month' }))
    const rows = menuRows('To')
    expect(rows.slice(rows.indexOf('[Rolling day]'))).toEqual(['[Rolling day]', 'today', 'end of week', 'end of month', 'end of next month ✓', '—', 'No end'])
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'today' }))
    fireEvent.click(screen.getByRole('button', { name: 'To: today' }))
    expect(menuRows('To')).not.toContain('end of next month')
  })

  it('the other end’s week token on this end is listed too (a From holding end of week)', () => {
    render(<Harness mode="relative" side="from" initial={{ kind: 'relative', token: 'end-of-week' }} log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'From: end of week' }))
    expect(menuRows('From')).toContain('end of week ✓')
  })

  it('a saved mix: the date end is its own choice (on Oct 1) while it is the value', () => {
    const onChange = vi.fn()
    render(<DateAnchorInput mode="relative" side="from" value={{ kind: 'fixed', iso: fixedIso(2026, 10, 1) }} label="From" day={DAY} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'From: on Oct 1' })).toBeInTheDocument()
    expect(screen.queryByLabelText('From: number of days')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'From: on Oct 1' }))
    const rows = menuRows('From')
    expect(rows.slice(-3)).toEqual(['—', 'on Oct 1 ✓', 'No start'])
    // Picking it again changes nothing.
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'on Oct 1' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
