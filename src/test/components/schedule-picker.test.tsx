import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { SchedulePicker } from '../../components/shared/SchedulePicker'
import type { ScheduledValue } from '../../models/scheduled-value'

beforeEach(() => {
  HTMLInputElement.prototype.showPicker = vi.fn()
})

afterEach(cleanup)

const today = new Date(2026, 3, 16)

function trigger(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button') as HTMLButtonElement
}

describe('SchedulePicker', () => {
  it('shows the default Schedule label when value is null', () => {
    const { container } = render(<SchedulePicker value={null} onChange={() => {}} today={today} />)
    expect(trigger(container).textContent).toContain('Schedule')
  })

  it('shows a scheduled label when a fuzzy value is set', () => {
    const { container } = render(
      <SchedulePicker value={{ kind: 'fuzzy', token: 'this-week' }} onChange={() => {}} today={today} />,
    )
    expect(trigger(container).textContent).toContain('This week')
  })

  it('shows a relative label for a precise value', () => {
    const { container } = render(
      <SchedulePicker value={{ kind: 'date', value: new Date(2026, 3, 17) }} onChange={() => {}} today={today} />,
    )
    expect(trigger(container).textContent).toContain('Tomorrow')
  })

  it('opens the menu when the trigger is clicked', () => {
    const { container } = render(<SchedulePicker value={null} onChange={() => {}} today={today} />)
    fireEvent.click(trigger(container))
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Tomorrow')).toBeInTheDocument()
    expect(screen.getByText('This week')).toBeInTheDocument()
    expect(screen.getByText('Next week')).toBeInTheDocument()
    expect(screen.getByText('This month')).toBeInTheDocument()
    expect(screen.getByText('Next month')).toBeInTheDocument()
  })

  it('emits a fuzzy value when a chip is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(<SchedulePicker value={null} onChange={onChange} today={today} />)
    fireEvent.click(trigger(container))
    fireEvent.click(screen.getByText('Today'))
    expect(onChange).toHaveBeenCalledWith({ kind: 'fuzzy', token: 'today' })
  })

  it('emits next-week when the Next week chip is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(<SchedulePicker value={null} onChange={onChange} today={today} />)
    fireEvent.click(trigger(container))
    fireEvent.click(screen.getByText('Next week'))
    expect(onChange).toHaveBeenCalledWith({ kind: 'fuzzy', token: 'next-week' })
  })

  it('emits a precise ScheduledValue when the date input changes', () => {
    const onChange = vi.fn()
    const { container } = render(<SchedulePicker value={null} onChange={onChange} today={today} />)
    fireEvent.click(trigger(container))
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-05-20' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0] as ScheduledValue
    expect(arg.kind).toBe('date')
    expect(arg.kind === 'date' && arg.value.getFullYear()).toBe(2026)
    expect(arg.kind === 'date' && arg.value.getMonth()).toBe(4)
    expect(arg.kind === 'date' && arg.value.getDate()).toBe(20)
  })

  it('emits null when Clear is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(
      <SchedulePicker value={{ kind: 'fuzzy', token: 'today' }} onChange={onChange} today={today} />,
    )
    fireEvent.click(trigger(container))
    fireEvent.click(screen.getByText('Clear'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('marks the active fuzzy chip as selected', () => {
    const { container } = render(
      <SchedulePicker value={{ kind: 'fuzzy', token: 'tomorrow' }} onChange={() => {}} today={today} />,
    )
    fireEvent.click(trigger(container))
    // "Tomorrow" also appears in the trigger label — scope to buttons inside the menu
    const menu = container.querySelector('[class*="menu"]') as HTMLElement
    const chips = menu.querySelectorAll('button')
    const tomorrowChip = Array.from(chips).find((b) => b.textContent === 'Tomorrow')!
    const todayChip = Array.from(chips).find((b) => b.textContent === 'Today')!
    expect(tomorrowChip.className).toMatch(/selected/i)
    expect(todayChip.className).not.toMatch(/selected/i)
  })
})
