import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ColorInput } from '../../components/shared/ColorInput'

beforeEach(() => {
  HTMLInputElement.prototype.showPicker = vi.fn()
})

afterEach(cleanup)

function getHexInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="text"]') as HTMLInputElement
}

function getSwatchInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="color"]') as HTMLInputElement
}

describe('ColorInput', () => {
  it('renders swatch and hex input with initial value', () => {
    const { container } = render(<ColorInput value="#537fe7" onChange={() => {}} />)
    const hex = getHexInput(container)
    const swatch = getSwatchInput(container)
    expect(hex.value).toBe('#537fe7')
    expect(swatch.value).toBe('#537fe7')
  })

  it('calls onChange when valid hex is typed', () => {
    const onChange = vi.fn()
    const { container } = render(<ColorInput value="#537fe7" onChange={onChange} />)
    fireEvent.change(getHexInput(container), { target: { value: '#ff0000' } })
    expect(onChange).toHaveBeenCalledWith('#ff0000')
  })

  it('does not call onChange for invalid hex', () => {
    const onChange = vi.fn()
    const { container } = render(<ColorInput value="#537fe7" onChange={onChange} />)
    fireEvent.change(getHexInput(container), { target: { value: '#gggggg' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('expands 3-digit hex to 6-digit', () => {
    const onChange = vi.fn()
    const { container } = render(<ColorInput value="#537fe7" onChange={onChange} />)
    fireEvent.change(getHexInput(container), { target: { value: '#abc' } })
    expect(onChange).toHaveBeenCalledWith('#aabbcc')
  })

  it('auto-adds # prefix when typing without it', () => {
    const onChange = vi.fn()
    const { container } = render(<ColorInput value="#537fe7" onChange={onChange} />)
    fireEvent.change(getHexInput(container), { target: { value: 'ff0000' } })
    expect(onChange).toHaveBeenCalledWith('#ff0000')
  })

  it('reverts hex text on blur when invalid', () => {
    const { container } = render(<ColorInput value="#537fe7" onChange={() => {}} />)
    const hex = getHexInput(container)
    fireEvent.change(hex, { target: { value: '#xyz' } })
    expect(hex.value).toBe('#xyz')
    fireEvent.blur(hex)
    expect(hex.value).toBe('#537fe7')
  })

  it('keeps valid hex text on blur', () => {
    const onChange = vi.fn()
    const { container } = render(<ColorInput value="#537fe7" onChange={onChange} />)
    const hex = getHexInput(container)
    fireEvent.change(hex, { target: { value: '#ff0000' } })
    fireEvent.blur(hex)
    expect(hex.value).toBe('#ff0000')
  })

  it('syncs hex text when value prop changes', () => {
    const { container, rerender } = render(<ColorInput value="#537fe7" onChange={() => {}} />)
    rerender(<ColorInput value="#00ff00" onChange={() => {}} />)
    expect(getHexInput(container).value).toBe('#00ff00')
  })

  it('calls onChange from native color picker', () => {
    const onChange = vi.fn()
    const { container } = render(<ColorInput value="#537fe7" onChange={onChange} />)
    fireEvent.change(getSwatchInput(container), { target: { value: '#ff0000' } })
    expect(onChange).toHaveBeenCalledWith('#ff0000')
  })

  it('normalizes hex to lowercase', () => {
    const onChange = vi.fn()
    const { container } = render(<ColorInput value="#537fe7" onChange={onChange} />)
    fireEvent.change(getHexInput(container), { target: { value: '#FF0000' } })
    expect(onChange).toHaveBeenCalledWith('#ff0000')
  })
})
