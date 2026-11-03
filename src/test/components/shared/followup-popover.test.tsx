import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FollowupPopover } from '../../../components/shared/followup/FollowupPopover'
import { useSettingsStore } from '../../../stores/settings-store'
import { formatWeekdayNumeric } from '../../../utils/followup'
import { makeTodo } from '../../helpers'

// Sat 10 Oct 2026.
const TODAY = new Date(2026, 9, 10, 9, 0)

const anchor = { kind: 'point', x: 10, y: 10 } as const

describe('<FollowupPopover> Next field and Mark followed up', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    useSettingsStore.setState({ autoFollowup: true, followupDefaultInterval: { count: 1, unit: 'm' } })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  // Tue 27 Oct is after today; Sat 10 Oct is today; Mon 5 Oct is overdue.
  const FUTURE = new Date(2026, 9, 27)
  const TODAY_DAY = new Date(2026, 9, 10)
  const OVERDUE = new Date(2026, 9, 5)

  function renderPopover(props: Partial<React.ComponentProps<typeof FollowupPopover>> = {}) {
    const onSetNext = vi.fn()
    const onFollowedUp = vi.fn()
    const onClose = vi.fn()
    render(
      <FollowupPopover
        todo={makeTodo({ id: 1, nextFollowupAt: FUTURE })}
        anchor={anchor}
        onClose={onClose}
        onSetNext={onSetNext}
        onFollowedUp={onFollowedUp}
        {...props}
      />,
    )
    const field = screen.getByRole('textbox', { name: 'Next follow-up' }) as HTMLInputElement
    const button = screen.getByRole('button', { name: 'Mark followed up' })
    return { onSetNext, onFollowedUp, onClose, field, button }
  }

  function tooltipOf(button: HTMLElement): string {
    fireEvent.pointerEnter(button)
    act(() => { vi.advanceTimersByTime(400) })
    return screen.getByRole('tooltip').textContent ?? ''
  }

  it('a next follow-up after today: the field shows it, no Was line, no Now: text; focus on the button', () => {
    const { field, button } = renderPopover()
    expect(field.value).toBe('Tue 27 Oct')
    expect(screen.queryByText(/^Now:/)).toBeNull()
    expect(screen.queryByText(/^Was /)).toBeNull()
    expect(button).toHaveFocus()
    // The button no longer names the date.
    expect(button).toHaveAccessibleName('Mark followed up')
  })

  it('start values: future kept · today / overdue / none → the rule (on: today + the interval, off: empty), with Was …', () => {
    const cases: Array<{ next?: Date; auto: boolean; value: string; was: string | null }> = [
      { next: FUTURE, auto: false, value: 'Tue 27 Oct', was: null },
      { next: TODAY_DAY, auto: true, value: 'Tue 10 Nov', was: 'Was today' },
      { next: TODAY_DAY, auto: false, value: '', was: 'Was today' },
      { next: OVERDUE, auto: true, value: 'Tue 10 Nov', was: 'Was Mon 10/05 · overdue' },
      { next: OVERDUE, auto: false, value: '', was: 'Was Mon 10/05 · overdue' },
      { auto: true, value: 'Tue 10 Nov', was: null },
      { auto: false, value: '', was: null },
    ]
    for (const c of cases) {
      useSettingsStore.setState({ autoFollowup: c.auto })
      const { field } = renderPopover({ todo: makeTodo({ id: 1, nextFollowupAt: c.next }) })
      expect(field.value, JSON.stringify(c)).toBe(c.value)
      if (c.was) {
        expect(screen.getByText(c.was)).toBeInTheDocument()
        // The help line is the field's description (the old Now: id is gone).
        expect(field).toHaveAccessibleDescription(c.was)
      } else {
        expect(screen.queryByText(/^Was /)).toBeNull()
      }
      cleanup()
    }
  })

  it('follows the Settings interval', () => {
    useSettingsStore.setState({ followupDefaultInterval: { count: 2, unit: 'w' } })
    const { field } = renderPopover({ todo: makeTodo({ id: 1, nextFollowupAt: OVERDUE }) })
    expect(field.value).toBe('Sat 24 Oct')
  })

  it('opened on the field (Pick a date or interval…): its text is selected', () => {
    const { field } = renderPopover({ initialFocus: 'next' })
    expect(field).toHaveFocus()
    expect(field.value).toBe('Tue 27 Oct')
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
  })

  it('focusing the field selects its text — once per click; a second click places the caret (no prevented mouseup)', () => {
    const { field } = renderPopover()
    // A click: mousedown, focus, mouseup.
    fireEvent.mouseDown(field)
    act(() => field.focus())
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
    // That mouseup would collapse the selection: its default is prevented.
    expect(fireEvent.mouseUp(field)).toBe(false)
    // A second click inside the focused field is the browser's.
    fireEvent.mouseDown(field)
    expect(fireEvent.mouseUp(field)).toBe(true)
  })

  it('Tab into the field selects its text too; a later click is left alone', () => {
    const { field } = renderPopover()
    fireEvent.change(field, { target: { value: '2w' } })
    act(() => field.blur())
    act(() => field.focus())
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 2])
    fireEvent.mouseDown(field)
    expect(fireEvent.mouseUp(field)).toBe(true)
  })

  it('Mark followed up untouched passes no date (the store keeps a later one) and closes — future, overdue or none', () => {
    for (const next of [FUTURE, OVERDUE, undefined]) {
      const { button, onFollowedUp, onSetNext, onClose } = renderPopover({ todo: makeTodo({ id: 1, nextFollowupAt: next }) })
      fireEvent.click(button)
      expect(onFollowedUp).toHaveBeenCalledTimes(1)
      expect(onFollowedUp.mock.calls[0]).toEqual([undefined])
      expect(onSetNext).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('its tooltip says what will happen: keep / set / clear / none', () => {
    expect(tooltipOf(renderPopover().button)).toBe('Record a follow-up today and keep the next follow-up')
    cleanup()
    expect(tooltipOf(renderPopover({ todo: makeTodo({ id: 1, nextFollowupAt: OVERDUE }) }).button))
      .toBe('Record a follow-up today and set the next follow-up to the date above')
    cleanup()
    useSettingsStore.setState({ autoFollowup: false })
    expect(tooltipOf(renderPopover({ todo: makeTodo({ id: 1, nextFollowupAt: OVERDUE }) }).button))
      .toBe('Record a follow-up today and clear the next follow-up')
    cleanup()
    expect(tooltipOf(renderPopover({ todo: makeTodo({ id: 1 }) }).button)).toBe('Record a follow-up today (no next follow-up)')
    cleanup()
    // Edited, a kept date's field says "set".
    const r = renderPopover()
    fireEvent.change(r.field, { target: { value: '2w' } })
    expect(tooltipOf(r.button)).toBe('Record a follow-up today and set the next follow-up to the date above')
  })

  it('an edited field: Mark followed up uses it (over a later date too)', () => {
    const { field, button, onFollowedUp } = renderPopover()
    fireEvent.change(field, { target: { value: '2w' } })
    fireEvent.click(button)
    expect(onFollowedUp).toHaveBeenCalledWith(new Date(2026, 9, 24))
  })

  it('a cleared field (×): Mark followed up clears the next follow-up; the tooltip says so', () => {
    const { field, button, onFollowedUp, onSetNext, onClose } = renderPopover()
    fireEvent.click(screen.getByRole('button', { name: 'Clear next follow-up' }))
    // × only empties the field (the row's own × clears the stored date).
    expect(field.value).toBe('')
    expect(field).toHaveFocus()
    expect(onSetNext).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(tooltipOf(button)).toBe('Record a follow-up today and clear the next follow-up')
    fireEvent.click(button)
    expect(onFollowedUp).toHaveBeenCalledWith(null)
  })

  it('text that isn’t a date disables Mark followed up, with the field’s error', () => {
    const { field, button, onFollowedUp } = renderPopover()
    fireEvent.change(field, { target: { value: 'whenever' } })
    expect(button).toBeDisabled()
    expect(screen.getByText('Try 2w, 10d, 1m, fri, 24 Oct or 10/24')).toBeInTheDocument()
    fireEvent.click(button)
    expect(onFollowedUp).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '3d' } })
    expect(button).toBeEnabled()
  })

  it('⏎ in the field sets the next follow-up only: the untouched replacement, an edited date, or none', () => {
    let r = renderPopover({ todo: makeTodo({ id: 1, nextFollowupAt: OVERDUE }) })
    fireEvent.keyDown(r.field, { key: 'Enter' })
    expect(r.onSetNext).toHaveBeenCalledWith(new Date(2026, 10, 10))
    expect(r.onFollowedUp).not.toHaveBeenCalled()
    expect(r.onClose).toHaveBeenCalledTimes(1)
    cleanup()

    r = renderPopover()
    fireEvent.change(r.field, { target: { value: '2w' } })
    fireEvent.keyDown(r.field, { key: 'Enter' })
    expect(r.onSetNext).toHaveBeenCalledWith(new Date(2026, 9, 24))
    cleanup()

    r = renderPopover()
    fireEvent.change(r.field, { target: { value: '' } })
    fireEvent.keyDown(r.field, { key: 'Enter' })
    expect(r.onSetNext).toHaveBeenCalledWith(null)
    cleanup()

    // Text that isn't a date: nothing happens.
    r = renderPopover()
    fireEvent.change(r.field, { target: { value: 'whenever' } })
    fireEvent.keyDown(r.field, { key: 'Enter' })
    expect(r.onSetNext).not.toHaveBeenCalled()
    expect(r.onClose).not.toHaveBeenCalled()
  })

  it('⏎ on a field that says what the task has now just closes', () => {
    // Untouched on a later date: it is the task's own.
    let r = renderPopover()
    fireEvent.keyDown(r.field, { key: 'Enter' })
    expect(r.onSetNext).not.toHaveBeenCalled()
    expect(r.onClose).toHaveBeenCalledTimes(1)
    cleanup()
    r = renderPopover({ todo: makeTodo({ id: 1, nextFollowupAt: OVERDUE }) })
    fireEvent.change(r.field, { target: { value: '10/05/2026' } })
    fireEvent.keyDown(r.field, { key: 'Enter' })
    expect(r.onSetNext).not.toHaveBeenCalled()
    expect(r.onClose).toHaveBeenCalledTimes(1)
    cleanup()
    // Off, an untouched empty field on a task with none: nothing to set either.
    useSettingsStore.setState({ autoFollowup: false })
    const off = renderPopover({ todo: makeTodo({ id: 1 }) })
    fireEvent.keyDown(off.field, { key: 'Enter' })
    expect(off.onSetNext).not.toHaveBeenCalled()
    expect(off.onClose).toHaveBeenCalledTimes(1)
  })

  it('a quick button sets the next follow-up only and closes, as a picked day does', () => {
    const { onSetNext, onFollowedUp, onClose } = renderPopover({ todo: makeTodo({ id: 1, nextFollowupAt: OVERDUE }) })
    fireEvent.click(screen.getByRole('button', { name: 'Follow up in 1 week' }))
    expect(onSetNext).toHaveBeenCalledWith(new Date(2026, 9, 17))
    expect(onFollowedUp).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the bulk bar’s mixed selection: an empty field (Each task’s own) and a help line; untouched, Mark followed up passes no date and ⏎ just closes', () => {
    let r = renderPopover({ current: 'mixed' })
    expect(r.field.value).toBe('')
    expect(r.field).toHaveAttribute('placeholder', 'Each task’s own')
    expect(screen.getByText(/^Future dates kept · the rest →/)).toHaveTextContent('Future dates kept · the rest → Tue 10 Nov')
    expect(tooltipOf(r.button)).toBe('Record a follow-up today; future next follow-ups are kept, the rest set to Tue 10 Nov')
    fireEvent.keyDown(r.field, { key: 'Enter' })
    expect(r.onSetNext).not.toHaveBeenCalled()
    expect(r.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(r.button)
    expect(r.onFollowedUp.mock.calls[0]).toEqual([undefined])
    cleanup()

    // Edited: that date for all (⏎ sets it).
    r = renderPopover({ current: 'mixed' })
    fireEvent.change(r.field, { target: { value: '27 Oct' } })
    expect(r.field).toHaveAttribute('placeholder', '2w, 1m, fri or a date')
    fireEvent.keyDown(r.field, { key: 'Enter' })
    expect(r.onSetNext).toHaveBeenCalledWith(new Date(2026, 9, 27))
    cleanup()

    useSettingsStore.setState({ autoFollowup: false })
    renderPopover({ current: 'mixed' })
    expect(screen.getByText('Future dates kept · the rest cleared')).toBeInTheDocument()
  })

  it('the bulk bar’s shared value: a later one in the field, none → the rule', () => {
    let r = renderPopover({ current: new Date(2026, 10, 3) })
    expect(r.field.value).toBe('Tue 3 Nov')
    cleanup()
    r = renderPopover({ current: null })
    expect(r.field.value).toBe('Tue 10 Nov')
  })
})

describe('formatWeekdayNumeric', () => {
  it('is the short weekday and the zero-padded MM/DD', () => {
    expect(formatWeekdayNumeric(new Date(2026, 9, 22))).toBe('Thu 10/22')
    expect(formatWeekdayNumeric(new Date(2027, 0, 5))).toBe('Tue 01/05')
  })
})

describe('<FollowupPopover> date picker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  function renderPopover(todo = makeTodo({ id: 1, nextFollowupAt: new Date(2026, 9, 13) })) {
    const onSetNext = vi.fn()
    const onClose = vi.fn()
    render(<FollowupPopover todo={todo} anchor={anchor} onClose={onClose} onSetNext={onSetNext} onFollowedUp={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Pick next follow-up date' })
    return { onSetNext, onClose, button, picker: button.nextElementSibling as HTMLInputElement }
  }

  it('the Next field has a calendar button, in the tab order, that opens the browser’s picker on the field’s day', () => {
    const { button, picker } = renderPopover()
    const showPicker = vi.fn()
    picker.showPicker = showPicker
    expect(button.tabIndex).toBe(0)
    expect(picker).toHaveAttribute('type', 'date')
    expect(picker.tabIndex).toBe(-1)
    // The field's day: the stored Tue 13 Oct, after today, is kept.
    expect(picker.value).toBe('2026-10-13')
    fireEvent.click(button)
    expect(showPicker).toHaveBeenCalledTimes(1)
  })

  it('without showPicker, the button focuses the date input instead', () => {
    const { button, picker } = renderPopover()
    picker.showPicker = () => { throw new Error('not allowed') }
    fireEvent.click(button)
    expect(picker).toHaveFocus()
  })

  it('a picked day sets the next follow-up and closes the popover', () => {
    const { onSetNext, onClose, picker } = renderPopover()
    fireEvent.change(picker, { target: { value: '2026-11-20' } })
    expect(onSetNext).toHaveBeenCalledWith(new Date(2026, 10, 20))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a cleared picker clears the next follow-up', () => {
    const { onSetNext, picker } = renderPopover()
    fireEvent.change(picker, { target: { value: '' } })
    expect(onSetNext).toHaveBeenCalledWith(null)
  })
})
