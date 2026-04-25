import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { DeadlinePicker } from '../../components/shared/DeadlinePicker'

beforeEach(() => {
  HTMLInputElement.prototype.showPicker = vi.fn()
})

afterEach(cleanup)

function getTrigger(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button') as HTMLButtonElement
}

function getDateInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="date"]') as HTMLInputElement
}

describe('DeadlinePicker', () => {
  it('renders default label when value is null', () => {
    const { container } = render(<DeadlinePicker value={null} onChange={() => {}} />)
    expect(getTrigger(container).textContent).toContain('Deadline')
  })

  it('renders a formatted date when a value is set', () => {
    const { container } = render(<DeadlinePicker value={new Date(2026, 3, 20)} onChange={() => {}} />)
    expect(getTrigger(container).textContent).toMatch(/4\/20\/2026|Apr 20/)
  })

  it('calls showPicker when the trigger is clicked', () => {
    const showPicker = vi.fn()
    HTMLInputElement.prototype.showPicker = showPicker
    const { container } = render(<DeadlinePicker value={null} onChange={() => {}} />)
    fireEvent.click(getTrigger(container))
    expect(showPicker).toHaveBeenCalled()
  })

  it('emits a precise Date when the date input changes', () => {
    const onChange = vi.fn()
    const { container } = render(<DeadlinePicker value={null} onChange={onChange} />)
    fireEvent.change(getDateInput(container), { target: { value: '2026-05-15' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0] as Date
    expect(arg).toBeInstanceOf(Date)
    expect(arg.getFullYear()).toBe(2026)
    expect(arg.getMonth()).toBe(4)
    expect(arg.getDate()).toBe(15)
  })

  it('emits null when the date input is cleared via change event', () => {
    const onChange = vi.fn()
    const { container } = render(<DeadlinePicker value={new Date(2026, 3, 20)} onChange={onChange} />)
    fireEvent.change(getDateInput(container), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('renders a clear affordance when a value is set, and emits null when clicked', () => {
    const onChange = vi.fn()
    const { container } = render(<DeadlinePicker value={new Date(2026, 3, 20)} onChange={onChange} />)
    const clearBtn = container.querySelector('[title="Clear deadline"]') as HTMLElement
    expect(clearBtn).toBeInTheDocument()
    fireEvent.click(clearBtn)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('does not render a clear affordance when value is null', () => {
    const { container } = render(<DeadlinePicker value={null} onChange={() => {}} />)
    expect(container.querySelector('[title="Clear deadline"]')).toBeNull()
  })
})
