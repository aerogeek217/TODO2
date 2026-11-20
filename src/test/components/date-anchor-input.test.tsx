import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DateAnchorInput } from '../../components/shared/DateAnchorInput'
import type { DateAnchor } from '../../models'
import type { DateAnchorSide, DateEntryMode } from '../../utils/date-anchor'

/**
 * One end of a date range (cr25 P8, D23 boards B / C). Calendar: a date
 * input and a Set to… action menu (each item with its day today) that fills
 * a fixed date. Relative (typed intervals, board R1): a field the end is
 * typed into — `+2w`, `-1m`, `+3d`, `today`, a rolling day's words —
 * written as soon as it reads, and a chevron of rolling days and No end; a
 * saved mix's date and a token the lists no longer offer show while they are
 * the value.
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
    expect(screen.queryByRole('button', { name: 'From: rolling days' })).toBeNull()
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

  it('To’s Set to… lists the ends with their day today, then Clear the date (off while empty)', () => {
    render(<Harness mode="calendar" side="to" log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: Set to…' }))
    expect(menuRows('Set To to')).toEqual([
      'Today · Mon 2 Nov', 'End of this week · Sun 8 Nov', 'End of this month · Mon 30 Nov', 'End of next month · Thu 31 Dec',
      '—', 'Clear the date',
    ])
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Clear the date' })).toBeDisabled()
  })

  it('From’s Set to… lists the starts (no day counts: those are typed in Relative)', () => {
    render(<Harness mode="calendar" side="from" log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'From: Set to…' }))
    expect(menuRows('Set From to')).toEqual([
      'Today · Mon 2 Nov', 'Start of this week · Mon 2 Nov', 'Start of this month · 11/01', 'Start of last month · 10/01',
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
  const field = (label = 'To') => screen.getByRole('textbox', { name: label })

  it('no end: an empty field (its placeholder No start / No end) and the chevron', () => {
    render(<Harness mode="relative" side="from" log={[]} />)
    expect(field('From')).toHaveValue('')
    expect(field('From')).toHaveAttribute('placeholder', 'No start')
    expect(screen.getByRole('button', { name: 'From: rolling days' })).toHaveAttribute('aria-haspopup', 'menu')
    cleanup()
    render(<Harness mode="relative" side="to" log={[]} />)
    expect(field()).toHaveAttribute('placeholder', 'No end')
  })

  it.each([
    [{ kind: 'offset', days: -7 }, '-7d'],
    [{ kind: 'offset', days: 14 }, '+14d'],
    [{ kind: 'offset', days: 2, unit: 'w' }, '+2w'],
    [{ kind: 'offset', days: -1, unit: 'm' }, '-1m'],
    [{ kind: 'offset', days: 0 }, 'today'],
    [{ kind: 'relative', token: 'today' }, 'today'],
    [{ kind: 'relative', token: 'end-of-week' }, 'end of week'],
  ] as const)('shows %o as %s, in the unit it was stored in', (initial, text) => {
    render(<Harness mode="relative" side="to" initial={initial} log={[]} describedBy="day-line" />)
    expect(field()).toHaveValue(text)
    expect(field()).toHaveAttribute('aria-describedby', 'day-line')
  })

  it('a typed interval is written as soon as it reads: +2w, -1m, +3d, today, a rolling day', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" log={log} />)
    const typed: [string, DateAnchor | null][] = [
      ['+2w', { kind: 'offset', days: 2, unit: 'w' }],
      ['-1m', { kind: 'offset', days: -1, unit: 'm' }],
      ['+3d', { kind: 'offset', days: 3 }],
      ['+1y', { kind: 'offset', days: 1, unit: 'y' }],
      ['today', { kind: 'relative', token: 'today' }],
      ['End of Month', { kind: 'relative', token: 'end-of-month' }],
      ['', null],
    ]
    for (const [text, anchor] of typed) {
      fireEvent.change(field(), { target: { value: text } })
      expect(log.at(-1), text).toEqual(anchor)
    }
  })

  it('text on its way (+2) writes nothing and says nothing until the field is left; then its hint, and Esc puts the end back', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" initial={{ kind: 'offset', days: 2, unit: 'w' }} log={log} />)
    fireEvent.change(field(), { target: { value: '+2' } })
    expect(log).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.blur(field())
    expect(screen.getByRole('alert')).toHaveTextContent('Type +2w, -1m, +3d or today, or pick a rolling day')
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(field()).toHaveValue('+2')
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(field()).toHaveValue('+2w')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(log).toEqual([])
  })

  it('⏎ on text that doesn’t read shows the hint; typing again hides it', () => {
    render(<Harness mode="relative" side="to" log={[]} />)
    fireEvent.change(field(), { target: { value: '2 weeks' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.change(field(), { target: { value: '+2w' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the chevron: the end’s rolling days, then No end', () => {
    render(<Harness mode="relative" side="to" initial={{ kind: 'offset', days: -7 }} log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: rolling days' }))
    expect(menuRows('To: rolling days')).toEqual(['[Rolling day]', 'today', 'end of week', 'end of month', '—', 'No end'])
  })

  it('From’s rolling days are starts', () => {
    render(<Harness mode="relative" side="from" log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'From: rolling days' }))
    expect(menuRows('From: rolling days')).toEqual(['[Rolling day]', 'today', 'start of week', 'start of month', '—', 'No start ✓'])
  })

  it('a rolling day picked fills the field with its words; No end clears it', () => {
    const log: (DateAnchor | null)[] = []
    render(<Harness mode="relative" side="to" initial={{ kind: 'offset', days: -7 }} log={log} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: rolling days' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'end of month' }))
    expect(log.at(-1)).toEqual({ kind: 'relative', token: 'end-of-month' })
    expect(field()).toHaveValue('end of month')
    fireEvent.click(screen.getByRole('button', { name: 'To: rolling days' }))
    expect(menuRows('To: rolling days')).toContain('end of month ✓')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'No end' }))
    expect(log.at(-1)).toBeNull()
    expect(field()).toHaveValue('')
  })

  it('a token the lists no longer offer is the value, listed under Rolling day only while it is', () => {
    render(<Harness mode="relative" side="to" initial={{ kind: 'relative', token: 'end-of-next-month' }} log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'To: rolling days' }))
    expect(menuRows('To: rolling days')).toEqual(['[Rolling day]', 'today', 'end of week', 'end of month', 'end of next month ✓', '—', 'No end'])
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'today' }))
    fireEvent.click(screen.getByRole('button', { name: 'To: rolling days' }))
    expect(menuRows('To: rolling days')).not.toContain('end of next month')
  })

  it('a saved mix: the date end shows as its date while it is the value; typed again unchanged, nothing is written', () => {
    const onChange = vi.fn()
    render(<DateAnchorInput mode="relative" side="from" value={{ kind: 'fixed', iso: fixedIso(2026, 10, 1) }} label="From" day={DAY} onChange={onChange} />)
    expect(field('From')).toHaveValue('10/1/2026')
    fireEvent.change(field('From'), { target: { value: '10/1/2026 ' } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
