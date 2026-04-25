import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { DateAnchorInput } from '../../components/shared/DateAnchorInput'
import type { DateAnchor } from '../../models'

afterEach(cleanup)

function dateInput(container: HTMLElement) {
  return container.querySelector('input[type="date"]') as HTMLInputElement
}

function tokenSelect(container: HTMLElement) {
  return container.querySelector('select') as HTMLSelectElement
}

describe('DateAnchorInput', () => {
  it('renders empty inputs and "None" selected when value is null', () => {
    const { container } = render(<DateAnchorInput value={null} onChange={() => {}} />)
    expect(dateInput(container).value).toBe('')
    expect(tokenSelect(container).value).toBe('__none__')
  })

  it('shows the ISO day in the date input for a fixed anchor', () => {
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput value={v} onChange={() => {}} />)
    expect(dateInput(container).value).toBe('2026-04-18')
    expect(tokenSelect(container).value).toBe('')
  })

  it('clears to null when "None" is explicitly picked from a fixed anchor', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput value={v} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: '__none__' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('fires a relative "yesterday" anchor when picked', () => {
    const onChange = vi.fn()
    const { container } = render(<DateAnchorInput value={null} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: 'yesterday' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'relative', token: 'yesterday' })
  })

  it('selects the matching token in the dropdown for a relative anchor', () => {
    const v: DateAnchor = { kind: 'relative', token: 'end-of-week' }
    const { container } = render(<DateAnchorInput value={v} onChange={() => {}} />)
    expect(tokenSelect(container).value).toBe('end-of-week')
    expect(dateInput(container).value).toBe('')
  })

  it('fires a fixed anchor when the native date input changes', () => {
    const onChange = vi.fn()
    const { container } = render(<DateAnchorInput value={null} onChange={onChange} />)
    fireEvent.change(dateInput(container), { target: { value: '2026-04-20' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0]
    expect(arg.kind).toBe('fixed')
    expect(arg.iso.slice(0, 10)).toBe('2026-04-20')
  })

  it('fires a relative anchor when a token is picked from the dropdown', () => {
    const onChange = vi.fn()
    const { container } = render(<DateAnchorInput value={null} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: 'start-of-next-week' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'relative', token: 'start-of-next-week' })
  })

  it('clears to null when a relative anchor is reset to None', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'relative', token: 'today' }
    const { container } = render(<DateAnchorInput value={v} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: '__none__' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('hides the Custom… option when no fixed anchor is set', () => {
    const { container } = render(<DateAnchorInput value={null} onChange={() => {}} />)
    const options = Array.from(tokenSelect(container).options).map(o => o.textContent)
    expect(options).not.toContain('Custom…')
  })

  it('shows the Custom… option when a fixed anchor is set', () => {
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput value={v} onChange={() => {}} />)
    const options = Array.from(tokenSelect(container).options).map(o => o.textContent)
    expect(options).toContain('Custom…')
  })

  it('clears to null when a fixed anchor date is emptied', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput value={v} onChange={onChange} />)
    fireEvent.change(dateInput(container), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('switching from fixed to relative replaces the value', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput value={v} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: 'end-of-month' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'relative', token: 'end-of-month' })
  })
})
