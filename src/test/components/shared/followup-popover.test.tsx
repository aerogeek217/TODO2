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

  function renderPopover(props: Partial<React.ComponentProps<typeof FollowupPopover>> = {}) {
    const onSetNext = vi.fn()
    const onFollowedUp = vi.fn()
    const onClose = vi.fn()
    render(
      <FollowupPopover
        todo={makeTodo({ id: 1, nextFollowupAt: new Date(2026, 9, 27) })}
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

  it('opens with the field on what Mark followed up sets (today + the interval), the task’s value as Now:, focus on the button', () => {
    const { field, button } = renderPopover()
    expect(field.value).toBe('Tue 10 Nov')
    expect(screen.getByText('Now: Tue 10/27')).toBeInTheDocument()
    expect(button).toHaveFocus()
    // The button no longer names the date.
    expect(button).toHaveAccessibleName('Mark followed up')
  })

  it('follows the Settings interval', () => {
    useSettingsStore.setState({ followupDefaultInterval: { count: 2, unit: 'w' } })
    const { field } = renderPopover()
    expect(field.value).toBe('Sat 24 Oct')
  })

  it('opened on the field (Pick a date or interval…): the proposal is selected', () => {
    const { field } = renderPopover({ initialFocus: 'next' })
    expect(field).toHaveFocus()
    expect(field.value).toBe('Tue 10 Nov')
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
  })

  it('with the automatic next follow-up off: the field opens empty, Now: none for a task without one; Mark followed up clears', () => {
    useSettingsStore.setState({ autoFollowup: false })
    const { field, button, onFollowedUp } = renderPopover({ todo: makeTodo({ id: 1 }) })
    expect(field.value).toBe('')
    expect(screen.getByText('Now: none')).toBeInTheDocument()
    fireEvent.click(button)
    expect(onFollowedUp).toHaveBeenCalledWith(null)
  })

  it('Mark followed up untouched sets the proposal; closes', () => {
    const { button, onFollowedUp, onSetNext, onClose } = renderPopover()
    fireEvent.click(button)
    expect(onFollowedUp).toHaveBeenCalledWith(new Date(2026, 10, 10))
    expect(onSetNext).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an edited field: Mark followed up uses it', () => {
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
    fireEvent.pointerEnter(button)
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Record a follow-up today and clear the next follow-up')
    fireEvent.click(button)
    expect(onFollowedUp).toHaveBeenCalledWith(null)
  })

  it('its tooltip says what it does with a date in the field', () => {
    const { button } = renderPopover()
    fireEvent.pointerEnter(button)
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Record a follow-up today and set the next follow-up to the date above')
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

  it('⏎ in the field sets the next follow-up only: the untouched proposal, an edited date, or none', () => {
    let r = renderPopover()
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
    const r = renderPopover()
    fireEvent.change(r.field, { target: { value: '27 Oct' } })
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

  it('a quick button sets the next follow-up only', () => {
    const { onSetNext, onFollowedUp } = renderPopover()
    fireEvent.click(screen.getByRole('button', { name: 'Follow up in 1 week' }))
    expect(onSetNext).toHaveBeenCalledWith(new Date(2026, 9, 17))
    expect(onFollowedUp).not.toHaveBeenCalled()
  })

  it('the bulk bar’s selection: Now: mixed, or the shared value; ⏎ with mixed always sets', () => {
    const r = renderPopover({ current: 'mixed' })
    expect(screen.getByText('Now: mixed')).toBeInTheDocument()
    fireEvent.change(r.field, { target: { value: '27 Oct' } })
    fireEvent.keyDown(r.field, { key: 'Enter' })
    expect(r.onSetNext).toHaveBeenCalledWith(new Date(2026, 9, 27))
    cleanup()
    renderPopover({ current: null })
    expect(screen.getByText('Now: none')).toBeInTheDocument()
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
    // The proposal (today + 1 month), not the stored Tue 13 Oct.
    expect(picker.value).toBe('2026-11-10')
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
