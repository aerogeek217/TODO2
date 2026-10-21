import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FollowupPopover } from '../../../components/shared/followup/FollowupPopover'
import { useSettingsStore } from '../../../stores/settings-store'
import { formatWeekdayNumeric } from '../../../utils/followup'
import { makeTodo } from '../../helpers'

// Sat 10 Oct 2026.
const TODAY = new Date(2026, 9, 10, 9, 0)

const anchor = { kind: 'point', x: 10, y: 10 } as const

describe('<FollowupPopover> Mark followed up button', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('reads "Mark followed up · Next: <Day MM/DD>" — the next follow-up it will set (today + the default interval)', () => {
    render(<FollowupPopover todo={makeTodo({ id: 1 })} anchor={anchor} onClose={vi.fn()} onSetNext={vi.fn()} onFollowedUp={vi.fn()} />)
    const button = screen.getByRole('button', { name: /^Mark followed up/ })
    // Default interval 1 month: Tue 10 Nov 2026.
    expect(button).toHaveAccessibleName('Mark followed up · Next: Tue 11/10')
    expect(button.textContent).not.toMatch(/next Tue/)
  })

  it('follows the Settings interval', () => {
    useSettingsStore.setState({ followupDefaultInterval: { count: 2, unit: 'w' } })
    render(<FollowupPopover todo={makeTodo({ id: 1 })} anchor={anchor} onClose={vi.fn()} onSetNext={vi.fn()} onFollowedUp={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Mark followed up/ })).toHaveAccessibleName('Mark followed up · Next: Sat 10/24')
  })

  it('its tooltip says what it does', () => {
    render(<FollowupPopover todo={makeTodo({ id: 1 })} anchor={anchor} onClose={vi.fn()} onSetNext={vi.fn()} onFollowedUp={vi.fn()} />)
    const button = screen.getByRole('button', { name: /^Mark followed up/ })
    fireEvent.pointerEnter(button)
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Record a follow-up today' + 'Next follow-up: Tue 11/10')
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

  it('the Next field has a calendar button, in the tab order, that opens the browser’s picker on the stored day', () => {
    const { button, picker } = renderPopover()
    const showPicker = vi.fn()
    picker.showPicker = showPicker
    expect(button.tabIndex).toBe(0)
    expect(picker).toHaveAttribute('type', 'date')
    expect(picker.tabIndex).toBe(-1)
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
