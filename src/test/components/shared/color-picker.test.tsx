import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, within } from '@testing-library/react'
import { ColorPicker } from '../../../components/shared/ColorPicker'
import { HUE_PRESET_HEX } from '../../../utils/layout-hue'

afterEach(cleanup)

describe('ColorPicker — the six preset hues, then the colour input', () => {
  it('offers the presets as swatches and the colour input; the preset whose colour is picked reads checked', () => {
    const { container, getByRole } = render(<ColorPicker value={HUE_PRESET_HEX.rose} onChange={() => {}} />)
    const presets = getByRole('radiogroup', { name: 'Preset colours' })
    expect(within(presets).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Teal', 'Violet', 'Blue', 'Green', 'Amber', 'Rose'])
    expect(within(presets).getByRole('radio', { name: 'Rose' })).toBeChecked()
    expect(container.querySelector<HTMLInputElement>('input[type="color"]')!.value).toBe(HUE_PRESET_HEX.rose)
    expect(container.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe(HUE_PRESET_HEX.rose)
    expect(container.querySelector('[data-color-picker]')).not.toHaveAttribute('data-custom')
  })

  it('a preset click gives its colour; a colour that is no preset leaves every preset unchecked and marks the picker custom', () => {
    const onChange = vi.fn()
    const { container, getByRole, rerender } = render(<ColorPicker value="#123456" onChange={onChange} />)
    expect(container.querySelector('[data-color-picker]')).toHaveAttribute('data-custom', 'true')
    expect(within(getByRole('radiogroup', { name: 'Preset colours' })).queryAllByRole('radio', { checked: true })).toHaveLength(0)
    fireEvent.click(getByRole('radio', { name: 'Blue' }))
    expect(onChange).toHaveBeenCalledWith(HUE_PRESET_HEX.blue)
    // A preset's colour typed in its own case is still that preset.
    rerender(<ColorPicker value={HUE_PRESET_HEX.blue.toUpperCase()} onChange={onChange} />)
    expect(getByRole('radio', { name: 'Blue' })).toBeChecked()
  })

  it('the hex field still takes any colour', () => {
    const onChange = vi.fn()
    const { container } = render(<ColorPicker value={HUE_PRESET_HEX.teal} onChange={onChange} />)
    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: '#ff6600' } })
    expect(onChange).toHaveBeenCalledWith('#ff6600')
  })

  it('`before` renders ahead of the presets (the layout dialog’s None)', () => {
    const { getByRole } = render(<ColorPicker value={HUE_PRESET_HEX.teal} onChange={() => {}} before={<input type="radio" aria-label="None" readOnly />} />)
    const radios = within(getByRole('radiogroup', { name: 'Preset colours' })).getAllByRole('radio')
    expect(radios[0]).toHaveAccessibleName('None')
    expect(radios).toHaveLength(7)
  })
})
