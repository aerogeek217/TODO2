import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { DateField } from '../../../../models/app-view'
import type { DateFilters } from '../../../../models'
import { DateFilterPanel, type DateFilterHost } from '../../../../components/shared/filters/DateFilterPanel'

/**
 * The date panel: a type button naming the type being edited and its menu
 * of the seven types (lit = filtering, with its clause; checked = selected),
 * a range per type, Show (Calendar · Relative, and Any · None on Due /
 * Planned / Next follow-up / Last follow-up — cr25 P8), Planned's None box
 * (held in Unplanned), Completed a range only (no Is not), Clear <Type> and
 * Clear all. Picking a type never writes. A Relative end is typed (`+2w`, `-1m`) or a rolling day picked from its chevron. Today is Mon 2 Nov 2026.
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

/** The type button (`Date type: Due`, `, filtering` when the type filters). */
const typeButton = () => screen.getByRole('button', { name: /^Date type: / })
/** Opens the type menu (if closed) and returns it. */
function typeMenu(): HTMLElement {
  if (typeButton().getAttribute('aria-expanded') !== 'true') fireEvent.click(typeButton())
  return screen.getByRole('menu', { name: 'Date type' })
}
/** A type's menu item, named by its type (and, lit, its clause after a comma). */
const typeItem = (name: string) => within(typeMenu()).getByRole('menuitemradio', { name: new RegExp(`^${name}(,|$)`) })
/** Picks a type from the menu: it selects it for editing. */
const pickType = (name: string) => fireEvent.click(typeItem(name))
/** The type selected: the button's name. */
const expectType = (name: string, filtering = false) => expect(typeButton()).toHaveAccessibleName(`Date type: ${name}${filtering ? ', filtering' : ''}`)
/** The types the menu lights (filtering), in order; closes the menu again. */
function litTypes(): string[] {
  const lit = within(typeMenu()).getAllByRole('menuitemradio').filter((el) => /accent/.test(el.className)).map((el) => el.dataset.menuLabel ?? '')
  fireEvent.click(typeButton())
  return lit
}
/** The body: the selected type's clause, named by its title. */
const body = () => screen.getByRole('group', { name: /date|follow|Completed|Created|Modified/ })
const today = { kind: 'relative' as const, token: 'today' as const }
const fixedIso = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString()

/** An end's Relative field, typed into (`+2w`, `-1m`, `today`, `end of week`). */
const relative = (end: 'From' | 'To') => screen.getByRole('textbox', { name: end })

/** Types `text` into an end's Relative field. */
const typeEnd = (end: 'From' | 'To', text: string) => fireEvent.change(relative(end), { target: { value: text } })

/** Picks `item` (its label) from an end's Relative chevron: the rolling days, No start / No end. */
function pickRelative(end: 'From' | 'To', item: string) {
  fireEvent.click(screen.getByRole('button', { name: `${end}: rolling days` }))
  const menu = screen.getByRole('menu', { name: `${end}: rolling days` })
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
    expectType('Due')
    expect(typeButton()).toHaveAttribute('aria-haspopup', 'menu')
    expect(typeButton()).toHaveAttribute('aria-expanded', 'false')
    expect(typeButton()).not.toHaveAttribute('data-filtering')
    expect(typeButton()).not.toHaveTextContent('filtering')
    expect(litTypes()).toEqual([])
    const panel = body()
    expect(within(panel).getByText('Due date')).toBeInTheDocument()
    expect(within(panel).getByText('Not filtering')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear Due' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
    expect(log).toEqual([])
  })

  it('opens on the first type that filters, or the type it is given', () => {
    const { unmount } = render(<Harness log={[]} initial={{ created: { match: 'range', start: today, end: null } }} />)
    expectType('Created', true)
    unmount()
    render(<Harness log={[]} initial={{ created: { match: 'range', start: today, end: null } }} initialField="followup" />)
    expectType('Next follow-up')
  })

  it('picking a type writes nothing and lights nothing (no invented dates)', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    for (const name of ['Planned', 'Next follow-up', 'Last follow-up', 'Completed', 'Created', 'Modified', 'Due']) {
      pickType(name)
      expectType(name)
    }
    expect(log).toEqual([])
    expect(litTypes()).toEqual([])
    expect(relative('From')).toHaveValue('')
    expect(relative('To')).toHaveValue('')
  })

  it('setting a range lights its type (a dot, “filtering”); a second type adds its own clause', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    pickRelative('From', 'today')
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: today, end: null } })
    expectType('Due', true)
    expect(typeButton()).toHaveAttribute('data-filtering')
    expect(typeButton()).toHaveTextContent('1 filtering')
    expect(within(body()).getByText('today or later')).toBeInTheDocument()

    pickType('Created')
    expect(log).toHaveLength(1)
    expect(relative('From')).toHaveValue('')
    pickRelative('From', 'start of week')
    expect(log.at(-1)).toEqual({
      deadline: { match: 'range', start: today, end: null },
      created: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: null },
    })
    expectType('Created', true)
    expect(typeButton()).toHaveTextContent('2 filtering')
    expect(typeButton()).toHaveAccessibleDescription('2 filtering')
    expect(litTypes()).toEqual(['Due', 'Created'])
  })

  it('a new range is Relative: a typed end is written as soon as it reads, in its unit; its day today is under it', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    expect(show('Relative')).toHaveAttribute('aria-checked', 'true')
    typeEnd('To', '+2w')
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 2, unit: 'w' } } })
    expect(relative('To')).toHaveValue('+2w')
    expect(within(body()).getByText('in 2 weeks or earlier')).toBeInTheDocument()
    // The day under the end, read with its field.
    screen.getByText('Mon, Nov 16 and earlier')
    expect(relative('To')).toHaveAccessibleDescription('Mon, Nov 16 and earlier')

    typeEnd('To', '+10d')
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 10 } } })
    // With a From, each end its day alone; a month back is a calendar month.
    typeEnd('From', '-1m')
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: { kind: 'offset', days: -1, unit: 'm' }, end: { kind: 'offset', days: 10 } } })
    expect(screen.getByText('Fri, Oct 2')).toBeInTheDocument()
    expect(screen.getByText('Thu, Nov 12')).toBeInTheDocument()
  })

  it('a typed end that doesn’t read writes nothing; its hint shows once the field is left', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    typeEnd('To', '2 weeks')
    expect(log).toEqual([])
    fireEvent.blur(relative('To'))
    expect(screen.getByRole('alert')).toHaveTextContent('Type +2w, -1m, +3d or today, or pick a rolling day')
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
    expect(relative('To')).toHaveValue('end of week')

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
    expect(relative('From')).toHaveValue('1/1/2023')
  })

  it('a saved mix (a date and today) opens in Relative with the date as its own choice', () => {
    render(<Harness log={[]} initial={{ deadline: { match: 'range', start: { kind: 'fixed', iso: fixedIso(2026, 10, 1) }, end: today } }} />)
    expect(show('Relative')).toHaveAttribute('aria-checked', 'true')
    expect(relative('From')).toHaveValue('10/1/2026')
    expect(relative('To')).toHaveValue('today')
    expect(screen.getByText('Thu, Oct 1')).toBeInTheDocument()
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
      expect(relative('From')).toHaveValue('10/1/2026')
    })

    it('another type and back keeps it; Clear <Type> puts it back to Relative (a new range)', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initial={{ deadline: { match: 'range', start: null, end: oct31 } }} />)
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '' } })
      pickType('Created')
      pickType('Due')
      expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-05' } })
      fireEvent.click(screen.getByRole('button', { name: 'Clear Due' }))
      expect(show('Relative')).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('a typed unit stays as typed through another type and back, and Calendar and back', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    typeEnd('To', '+1m')
    pickType('Created')
    pickType('Due')
    expect(relative('To')).toHaveValue('+1m')
    fireEvent.click(show('Calendar'))
    expect(screen.getByLabelText('To')).toHaveValue('2026-12-02')
    fireEvent.click(show('Relative'))
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 1, unit: 'm' } } })
    expect(relative('To')).toHaveValue('+1m')
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
    expect(within(body()).getByText('Last followed up')).toBeInTheDocument()
    pickRelative('To', 'today')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also tasks never followed up' }))
    expect(log.at(-1)).toEqual({ lastFollowup: { match: 'range', start: null, end: { kind: 'relative', token: 'today' }, includeNoDate: true } })
    expectType('Last follow-up', true)
    const group = screen.getByRole('radiogroup', { name: 'Which tasks' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Calendar', 'Relative', 'Any', 'None'])
    fireEvent.click(within(group).getByRole('radio', { name: 'Any' }))
    expect(screen.getByText('Only tasks that have been followed up.')).toBeInTheDocument()
    expect(within(body()).getByText('any date')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('radio', { name: 'None' }))
    expect(log.at(-1)).toEqual({ lastFollowup: { match: 'unset' } })
    expect(within(body()).getByText('never')).toBeInTheDocument()
    expect(screen.getByText('Only tasks never followed up.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear Last follow-up' }))
    expect(log.at(-1)).toEqual({})
  })

  it('a host can leave Completed out (the check-in): six types in the menu', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} initialField="completed" host={{ omit: ['completed'] }} />)
    // An omitted initial type opens on the first offered one.
    expectType('Due')
    const menu = typeMenu()
    expect(within(menu).getAllByRole('menuitemradio').map((el) => el.dataset.menuLabel)).toEqual(['Due', 'Planned', 'Next follow-up', 'Last follow-up', 'Created', 'Modified'])
    // The separator still sets the record (Created · Modified) apart.
    const parts = Array.from(menu.children).map((el) => (el.getAttribute('role') === 'separator' ? '-' : (el as HTMLElement).dataset.menuLabel))
    expect(parts).toEqual(['Due', 'Planned', 'Next follow-up', 'Last follow-up', '-', 'Created', 'Modified'])
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
    expectType('Completed', true)
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
    expect(within(body()).getByText('on or before end of week, or none')).toBeInTheDocument()
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
    expect(within(body()).getByText('any date')).toBeInTheDocument()
    expectType('Due', true)
    fireEvent.click(within(group).getByRole('radio', { name: 'None' }))
    expect(log.at(-1)).toEqual({ deadline: { match: 'unset' } })
    expect(screen.getByText('Only tasks with no due date.')).toBeInTheDocument()
    expect(within(body()).getByText('none')).toBeInTheDocument()
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
    expect(typeButton()).toBeInTheDocument()
    pickType('Created')
    expect(screen.getByRole('button', { name: 'Clear Created' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(log.at(-1)).toEqual({})
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
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

  it('Home / End move the Show choice to the first / last (P7–P8 review)', () => {
    const log: DateFilters[] = []
    render(<Harness log={log} />)
    fireEvent.keyDown(show('Relative'), { key: 'End' })
    expect(log.at(-1)).toEqual({ deadline: { match: 'unset' } })
    expect(document.activeElement).toBe(show('None'))
    fireEvent.keyDown(show('None'), { key: 'Home' })
    expect(show('Calendar')).toHaveAttribute('aria-checked', 'true')
    expect(document.activeElement).toBe(show('Calendar'))
    // Created's two choices.
    pickType('Created')
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
      typeEnd('To', '+14d')
      expect(log.at(-1)).toEqual({ followup: { match: 'range', start: today, end: { kind: 'offset', days: 14 }, not: true } })
      expect(within(body()).getByText('not within the next 14 days')).toBeInTheDocument()
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
      pickType('Completed')
      expect(screen.queryByRole('radiogroup', { name: 'Completed: is or is not' })).toBeNull()
    })

    it('a pending Is not is per type: another type and Clear <Type> leave it; clearing a range keeps its Is not pending', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initialField="deadline" initial={{ created: { match: 'range', start: null, end: today } }} />)
      fireEvent.click(isNot('Due'))
      pickType('Created')
      expect(is('Created')).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'Clear Created' }))
      pickType('Due')
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
    expect(screen.getByText('Mon, Nov 2 and later')).toBeInTheDocument()
    const sw = screen.getByRole('switch', { name: 'Also tasks with no due date' })
    fireEvent.click(sw)
    expect(log.at(-1)).toEqual({ deadline: { match: 'range', start: today, end: null, includeNoDate: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all dates' }))
    expect(log.at(-1)).toEqual({})
  })

  describe('the type button and its menu', () => {
    it('lists the seven types, the record after a separator; lit types carry their clause, the selected one is checked', () => {
      render(<Harness log={[]} initialField="planned" initial={{ deadline: { match: 'set' }, planned: { match: 'range', start: today, end: { kind: 'offset', days: 7 } } }} />)
      expectType('Planned', true)
      expect(typeButton()).toHaveTextContent('Planned2 filtering')
      const menu = typeMenu()
      const parts = Array.from(menu.children).map((el) => (el.getAttribute('role') === 'separator' ? '-' : (el as HTMLElement).dataset.menuLabel))
      expect(parts).toEqual(['Due', 'Planned', 'Next follow-up', 'Last follow-up', '-', 'Completed', 'Created', 'Modified'])
      // The clause in the header's words, read after the name.
      expect(typeItem('Due')).toHaveAccessibleName('Due, any date')
      expect(typeItem('Planned')).toHaveAccessibleName('Planned, within the next 7 days')
      expect(typeItem('Created')).toHaveAccessibleName('Created')
      expect(typeItem('Planned')).toHaveAttribute('aria-checked', 'true')
      expect(typeItem('Due')).toHaveAttribute('aria-checked', 'false')
      expect(litTypes()).toEqual(['Due', 'Planned'])
    })

    it('a pick selects the type, closes the menu and gives the focus back to the button', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} />)
      pickType('Modified')
      expectType('Modified')
      expect(screen.queryByRole('menu', { name: 'Date type' })).toBeNull()
      expect(typeButton()).toHaveAttribute('aria-expanded', 'false')
      expect(document.activeElement).toBe(typeButton())
      expect(within(body()).getByText('Modified')).toBeInTheDocument()
      expect(log).toEqual([])
    })

    it('keyboard: ↓ opens the menu on the selected type, the arrows move, Enter picks, Esc closes back to the button', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initialField="followup" />)
      typeButton().focus()
      fireEvent.keyDown(typeButton(), { key: 'ArrowDown' })
      const menu = screen.getByRole('menu', { name: 'Date type' })
      expect(typeButton()).toHaveAttribute('aria-expanded', 'true')
      expect(document.activeElement).toBe(typeItem('Next follow-up'))
      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(typeItem('Last follow-up'))
      fireEvent.keyDown(menu, { key: 'End' })
      expect(document.activeElement).toBe(typeItem('Modified'))
      fireEvent.keyDown(menu, { key: 'Home' })
      expect(document.activeElement).toBe(typeItem('Due'))
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByRole('menu', { name: 'Date type' })).toBeNull()
      expect(document.activeElement).toBe(typeButton())
      expectType('Next follow-up')
      // Enter on the button (a click) opens it again; Enter on an item (a click) picks it.
      fireEvent.click(typeButton())
      fireEvent.keyDown(screen.getByRole('menu', { name: 'Date type' }), { key: 'ArrowUp' })
      expect(document.activeElement).toBe(typeItem('Planned'))
      fireEvent.click(typeItem('Planned'), { detail: 0 })
      expectType('Planned')
      expect(document.activeElement).toBe(typeButton())
      expect(log).toEqual([])
    })

    it('Esc on the closed button is left to the panel’s host (the popover closes)', () => {
      const onKey = vi.fn()
      document.addEventListener('keydown', onKey)
      render(<Harness log={[]} />)
      fireEvent.keyDown(typeButton(), { key: 'Escape' })
      expect(onKey).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape', defaultPrevented: false }))
      document.removeEventListener('keydown', onKey)
    })

    it('autoFocus focuses the type button', () => {
      render(<DateFilterPanel dates={{}} onChange={() => {}} autoFocus />)
      expect(document.activeElement).toBe(typeButton())
    })

    it('the phone sheet: the same button and menu, its items touch-size', () => {
      render(<Harness log={[]} variant="sheet" initial={{ created: { match: 'range', start: today, end: null } }} />)
      expectType('Created', true)
      const menu = typeMenu()
      expect(menu.className).toMatch(/touch/)
      fireEvent.click(typeItem('Planned'))
      expectType('Planned')
    })
  })

  describe('Planned', () => {
    it('is a date like Due: Show has Any / None, its range has Is / Is not and “Also tasks with no planned date”', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initialField="planned" />)
      expect(within(body()).getByText('Planned date')).toBeInTheDocument()
      expect(within(screen.getByRole('radiogroup', { name: 'Which tasks' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Calendar', 'Relative', 'Any', 'None'])
      expect(screen.getByRole('radiogroup', { name: 'Planned: is or is not' })).toBeInTheDocument()
      typeEnd('To', '+7d')
      fireEvent.click(screen.getByRole('checkbox', { name: 'Also tasks with no planned date' }))
      expect(log.at(-1)).toEqual({ planned: { match: 'range', start: null, end: { kind: 'offset', days: 7 }, includeNoDate: true } })
      fireEvent.click(show('Any'))
      expect(log.at(-1)).toEqual({ planned: { match: 'set' } })
      expect(screen.getByText('Only tasks that have a planned date.')).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: 'Only tasks held in Unplanned' })).toBeNull()
    })

    it('None shows “Only tasks held in Unplanned”, switching the clause between unset and held', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initialField="planned" />)
      fireEvent.click(show('None'))
      expect(log.at(-1)).toEqual({ planned: { match: 'unset' } })
      expect(within(body()).getByText('none')).toBeInTheDocument()
      const box = screen.getByRole('checkbox', { name: 'Only tasks held in Unplanned' })
      expect(box).not.toBeChecked()
      fireEvent.click(box)
      expect(log.at(-1)).toEqual({ planned: { match: 'held' } })
      expect(box).toBeChecked()
      expect(show('None')).toHaveAttribute('aria-checked', 'true')
      expect(within(body()).getByText('held in Unplanned')).toBeInTheDocument()
      expect(typeItem('Planned')).toHaveAccessibleName('Planned, held in Unplanned')
      fireEvent.click(typeButton())
      fireEvent.click(box)
      expect(log.at(-1)).toEqual({ planned: { match: 'unset' } })
      // Clear Planned drops it either way.
      fireEvent.click(box)
      fireEvent.click(screen.getByRole('button', { name: 'Clear Planned' }))
      expect(log.at(-1)).toEqual({})
    })

    it('a held clause opens on None with the box ticked; Any replaces it', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} initial={{ planned: { match: 'held' } }} />)
      expectType('Planned', true)
      expect(show('None')).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('checkbox', { name: 'Only tasks held in Unplanned' })).toBeChecked()
      fireEvent.click(show('Any'))
      expect(log.at(-1)).toEqual({ planned: { match: 'set' } })
    })

    it('the phone sheet: the box is a switch', () => {
      const log: DateFilters[] = []
      render(<Harness log={log} variant="sheet" initial={{ planned: { match: 'unset' } }} />)
      const sw = screen.getByRole('switch', { name: 'Only tasks held in Unplanned' })
      expect(sw).toHaveAttribute('aria-checked', 'false')
      fireEvent.click(sw)
      expect(log.at(-1)).toEqual({ planned: { match: 'held' } })
      expect(sw).toHaveAttribute('aria-checked', 'true')
    })
  })
})
