import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { DateAnchorInput } from '../../components/shared/DateAnchorInput'
import type { DateAnchor } from '../../models'

afterEach(cleanup)

function dateInput(container: HTMLElement) {
  return container.querySelector('input[type="date"]') as HTMLInputElement
}

function offsetInput(container: HTMLElement) {
  return container.querySelector('input[inputmode="numeric"]') as HTMLInputElement
}

function tokenSelect(container: HTMLElement) {
  return container.querySelector('select') as HTMLSelectElement
}

describe('DateAnchorInput', () => {
  it('renders empty inputs and "None" selected when value is null', () => {
    const { container } = render(<DateAnchorInput side="from" value={null} onChange={() => {}} />)
    expect(dateInput(container).value).toBe('')
    expect(tokenSelect(container).value).toBe('__none__')
  })

  it('shows the ISO day in the date input for a fixed anchor', () => {
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={() => {}} />)
    expect(dateInput(container).value).toBe('2026-04-18')
    expect(tokenSelect(container).value).toBe('')
  })

  it('clears to null when "None" is explicitly picked from a fixed anchor', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: '__none__' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('fires a relative "start-of-week" anchor when picked on From', () => {
    const onChange = vi.fn()
    const { container } = render(<DateAnchorInput side="from" value={null} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: 'start-of-week' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'relative', token: 'start-of-week' })
  })

  it('selects the matching token in the dropdown for a relative anchor', () => {
    const v: DateAnchor = { kind: 'relative', token: 'end-of-week' }
    const { container } = render(<DateAnchorInput side="to" value={v} onChange={() => {}} />)
    expect(tokenSelect(container).value).toBe('end-of-week')
    expect(dateInput(container).value).toBe('')
  })

  it('fires a fixed anchor when the native date input changes', () => {
    const onChange = vi.fn()
    const { container } = render(<DateAnchorInput side="from" value={null} onChange={onChange} />)
    fireEvent.change(dateInput(container), { target: { value: '2026-04-20' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0]
    expect(arg.kind).toBe('fixed')
    expect(arg.iso.slice(0, 10)).toBe('2026-04-20')
  })

  it('fires a relative anchor when a token is picked from the dropdown', () => {
    const onChange = vi.fn()
    const { container } = render(<DateAnchorInput side="to" value={null} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: 'end-of-week' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'relative', token: 'end-of-week' })
  })

  it('clears to null when a relative anchor is reset to None', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'relative', token: 'today' }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: '__none__' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('hides the Custom… option when no fixed anchor is set', () => {
    const { container } = render(<DateAnchorInput side="from" value={null} onChange={() => {}} />)
    const options = Array.from(tokenSelect(container).options).map(o => o.textContent)
    expect(options).not.toContain('Custom…')
  })

  it('shows the Custom… option when a fixed anchor is set', () => {
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={() => {}} />)
    const options = Array.from(tokenSelect(container).options).map(o => o.textContent)
    expect(options).toContain('Custom…')
  })

  it('clears to null when a fixed anchor date is emptied', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(dateInput(container), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('switching from fixed to relative replaces the value', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: 'today' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'relative', token: 'today' })
  })

  it('exposes a "Custom offset…" option in the dropdown', () => {
    const { container } = render(<DateAnchorInput side="from" value={null} onChange={() => {}} />)
    const options = Array.from(tokenSelect(container).options).map(o => o.textContent)
    expect(options).toContain('Custom offset…')
  })

  it('initializes offset to days=0 when "Custom offset…" is picked from null', () => {
    const onChange = vi.fn()
    const { container } = render(<DateAnchorInput side="from" value={null} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: '__offset__' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'offset', days: 0 })
  })

  it('preserves prior days when re-picking "Custom offset…" while already in offset mode', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'offset', days: -7 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: '__offset__' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'offset', days: -7 })
  })

  it('preserves prior custom days when re-picking "Custom offset…"', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'offset', days: -9 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: '__offset__' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'offset', days: -9 })
  })

  it('swaps the date input for a numeric text input when in offset mode', () => {
    const v: DateAnchor = { kind: 'offset', days: -3 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={() => {}} />)
    expect(container.querySelector('input[type="date"]')).toBeNull()
    const num = offsetInput(container)
    expect(num).not.toBeNull()
    expect(num.value).toBe('-3')
    expect(tokenSelect(container).value).toBe('__offset__')
  })

  it('fires an updated offset anchor as the days input changes', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'offset', days: 0 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(offsetInput(container), { target: { value: '14' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'offset', days: 14 })
  })

  it('rejects non-integer keystrokes (no commit, no display change)', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'offset', days: 0 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(offsetInput(container), { target: { value: '7.9' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('holds a lone "-" as a draft without committing or wiping the dash', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'offset', days: 0 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(offsetInput(container), { target: { value: '-' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(offsetInput(container).value).toBe('-')
  })

  it('commits a negative offset once the user finishes typing "-7"', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'offset', days: 0 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(offsetInput(container), { target: { value: '-' } })
    fireEvent.change(offsetInput(container), { target: { value: '-7' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ kind: 'offset', days: -7 })
  })

  it('preserves the last committed days when the input is cleared mid-edit', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'offset', days: -5 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(offsetInput(container), { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
    // draft string shows empty until blur
    expect(offsetInput(container).value).toBe('')
  })

  it('snaps the input back to the committed days on blur', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'offset', days: -5 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(offsetInput(container), { target: { value: '' } })
    fireEvent.blur(offsetInput(container))
    expect(offsetInput(container).value).toBe('-5')
  })

  it('clears to null when "None" is picked from offset mode', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'offset', days: -7 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: '__none__' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('switching from offset to a named token replaces the value', () => {
    const onChange = vi.fn()
    const v: DateAnchor = { kind: 'offset', days: -7 }
    const { container } = render(<DateAnchorInput side="from" value={v} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: 'start-of-week' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'relative', token: 'start-of-week' })
  })
})

function optionLabels(container: HTMLElement): (string | null)[] {
  return Array.from(tokenSelect(container).options).map(o => o.textContent)
}

function selectedLabel(container: HTMLElement): string | null | undefined {
  const s = tokenSelect(container)
  return s.options[s.selectedIndex]?.textContent
}

function optionValue(container: HTMLElement, label: string): string | undefined {
  return Array.from(tokenSelect(container).options).find(o => o.textContent === label)?.value
}

describe('DateAnchorInput: the short From / To lists', () => {
  const OFFSETS = ['1 week ago', '2 weeks ago', '1 month ago', 'In 1 week', 'In 2 weeks', 'In 1 month']

  it('From lists None, Today, Start of week, the six offsets and Custom offset…', () => {
    const { container } = render(<DateAnchorInput side="from" value={null} onChange={() => {}} />)
    expect(optionLabels(container)).toEqual(['None', 'Today', 'Start of week', ...OFFSETS, 'Custom offset…'])
  })

  it('To lists End of week in Start of week’s place', () => {
    const { container } = render(<DateAnchorInput side="to" value={null} onChange={() => {}} />)
    expect(optionLabels(container)).toEqual(['None', 'Today', 'End of week', ...OFFSETS, 'Custom offset…'])
  })

  it('a fixed date puts Custom… first, as before', () => {
    const v: DateAnchor = { kind: 'fixed', iso: '2026-04-18T00:00:00.000Z' }
    const { container } = render(<DateAnchorInput side="to" value={v} onChange={() => {}} />)
    expect(optionLabels(container)).toEqual(['Custom…', 'None', 'Today', 'End of week', ...OFFSETS, 'Custom offset…'])
    expect(selectedLabel(container)).toBe('Custom…')
  })

  it.each([
    ['1 week ago', -7], ['2 weeks ago', -14], ['1 month ago', -30],
    ['In 1 week', 7], ['In 2 weeks', 14], ['In 1 month', 30],
  ] as const)('picking %s stores a %i-day offset', (label, days) => {
    const onChange = vi.fn()
    const { container } = render(<DateAnchorInput side="from" value={null} onChange={onChange} />)
    fireEvent.change(tokenSelect(container), { target: { value: optionValue(container, label) } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'offset', days })
  })

  it.each([
    [-7, '1 week ago'], [-14, '2 weeks ago'], [-30, '1 month ago'],
    [7, 'In 1 week'], [14, 'In 2 weeks'], [30, 'In 1 month'],
  ] as const)('a stored %i-day offset selects %s and shows the days field', (days, label) => {
    const { container } = render(<DateAnchorInput side="to" value={{ kind: 'offset', days }} onChange={() => {}} />)
    expect(selectedLabel(container)).toBe(label)
    expect(offsetInput(container).value).toBe(String(days))
    expect(dateInput(container)).toBeNull()
  })

  it('any other offset, and 0, selects Custom offset…', () => {
    for (const days of [0, -9, 21, 31]) {
      const { container, unmount } = render(<DateAnchorInput side="from" value={{ kind: 'offset', days }} onChange={() => {}} />)
      expect(selectedLabel(container)).toBe('Custom offset…')
      expect(offsetInput(container).value).toBe(String(days))
      unmount()
    }
  })

  it('the named days select themselves', () => {
    const { container, rerender } = render(<DateAnchorInput side="from" value={{ kind: 'relative', token: 'today' }} onChange={() => {}} />)
    expect(selectedLabel(container)).toBe('Today')
    rerender(<DateAnchorInput side="from" value={{ kind: 'relative', token: 'start-of-week' }} onChange={() => {}} />)
    expect(selectedLabel(container)).toBe('Start of week')
    rerender(<DateAnchorInput side="to" value={{ kind: 'relative', token: 'end-of-week' }} onChange={() => {}} />)
    expect(selectedLabel(container)).toBe('End of week')
  })

  it('a stored token the list no longer offers shows as an extra option after None, only while it is the value', () => {
    const { container, rerender } = render(<DateAnchorInput side="to" value={{ kind: 'relative', token: 'end-of-month' }} onChange={() => {}} />)
    expect(optionLabels(container)).toEqual(['None', 'End of month', 'Today', 'End of week', ...OFFSETS, 'Custom offset…'])
    expect(selectedLabel(container)).toBe('End of month')
    rerender(<DateAnchorInput side="to" value={{ kind: 'relative', token: 'today' }} onChange={() => {}} />)
    expect(optionLabels(container)).not.toContain('End of month')
  })

  it('the other end’s week token is an extra option too (From with End of week, To with Start of week)', () => {
    const { container, rerender } = render(<DateAnchorInput side="from" value={{ kind: 'relative', token: 'end-of-week' }} onChange={() => {}} />)
    expect(optionLabels(container)).toEqual(['None', 'End of week', 'Today', 'Start of week', ...OFFSETS, 'Custom offset…'])
    expect(selectedLabel(container)).toBe('End of week')
    rerender(<DateAnchorInput side="to" value={{ kind: 'relative', token: 'start-of-week' }} onChange={() => {}} />)
    expect(optionLabels(container)).toEqual(['None', 'Start of week', 'Today', 'End of week', ...OFFSETS, 'Custom offset…'])
    expect(selectedLabel(container)).toBe('Start of week')
  })

  it('editing the days field moves the select between a preset and Custom offset…', () => {
    function Controlled() {
      const [v, setV] = useState<DateAnchor | null>({ kind: 'offset', days: -7 })
      return <DateAnchorInput side="from" value={v} onChange={setV} />
    }
    const { container } = render(<Controlled />)
    expect(selectedLabel(container)).toBe('1 week ago')
    fireEvent.change(offsetInput(container), { target: { value: '-8' } })
    expect(selectedLabel(container)).toBe('Custom offset…')
    fireEvent.change(offsetInput(container), { target: { value: '-14' } })
    expect(selectedLabel(container)).toBe('2 weeks ago')
    fireEvent.change(offsetInput(container), { target: { value: '30' } })
    expect(selectedLabel(container)).toBe('In 1 month')
    fireEvent.change(offsetInput(container), { target: { value: '0' } })
    expect(selectedLabel(container)).toBe('Custom offset…')
  })

  it('picking a preset while a days draft is held replaces the draft', () => {
    function Controlled() {
      const [v, setV] = useState<DateAnchor | null>({ kind: 'offset', days: 5 })
      return <DateAnchorInput side="to" value={v} onChange={setV} />
    }
    const { container } = render(<Controlled />)
    fireEvent.change(offsetInput(container), { target: { value: '-' } })
    expect(offsetInput(container).value).toBe('-')
    fireEvent.change(tokenSelect(container), { target: { value: optionValue(container, 'In 2 weeks') } })
    expect(offsetInput(container).value).toBe('14')
    expect(selectedLabel(container)).toBe('In 2 weeks')
  })
})

