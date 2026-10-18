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
