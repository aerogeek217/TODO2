import { afterEach, describe, it, expect, vi } from 'vitest'
import { useRef, useState } from 'react'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { IconPicker } from '../../../components/shared/IconPicker'
import { emojiFieldHint } from '../../../components/shared/icon-picker-choices'
import type { IconValue } from '../../../models/icon'

function Harness({ initial, recent = [], onPick }: { initial?: IconValue; recent?: string[]; onPick?: (icon: IconValue) => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(true)
  const [value, setValue] = useState<IconValue | undefined>(initial)
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(true)}>Opener</button>
      <span data-testid="value">{JSON.stringify(value ?? null)}</span>
      {open && (
        <IconPicker
          anchorRef={ref}
          value={value}
          fallback={{ kind: 'line', key: 'calendar' }}
          recent={recent}
          onPick={(icon) => { setValue(icon); onPick?.(icon) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

afterEach(cleanup)

const value = () => JSON.parse(screen.getByTestId('value').textContent ?? 'null') as IconValue | null

describe('IconPicker', () => {
  it('opens on Icons with the current (fallback) icon marked and focused; a pick closes it', () => {
    render(<Harness />)
    expect(screen.getByRole('tab', { name: 'Icons' })).toHaveAttribute('aria-selected', 'true')
    const calendar = screen.getByRole('button', { name: 'Calendar' })
    expect(calendar).toHaveAttribute('aria-pressed', 'true')
    expect(calendar).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Flag' }))
    expect(value()).toEqual({ kind: 'line', key: 'flag' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the arrow keys move through the grid (eight to a row)', () => {
    render(<Harness />)
    const calendar = screen.getByRole('button', { name: 'Calendar' })
    fireEvent.keyDown(calendar, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Layout' })).toHaveFocus()
  })

  it('the Emoji tab focuses its field; an emoji arriving is applied at once, the rest dropped; it stays open', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Emoji' }))
    const field = screen.getByRole('textbox', { name: 'Emoji' })
    expect(field).toHaveFocus()
    fireEvent.change(field, { target: { value: 'rocket🚀' } })
    expect(value()).toEqual({ kind: 'emoji', emoji: '🚀' })
    expect(field).toHaveValue('')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('refuses text that isn’t an emoji on Enter, and two emoji at once', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Emoji' }))
    const field = screen.getByRole('textbox', { name: 'Emoji' })
    fireEvent.change(field, { target: { value: 'rocket' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('That isn’t an emoji')
    fireEvent.change(field, { target: { value: '🚀🔥' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Pick one emoji at a time.')
    expect(value()).toBeNull()
  })

  it('Show as Color is written on the current emoji, and kept for the next pick', () => {
    render(<Harness initial={{ kind: 'emoji', emoji: '📅' }} recent={['📅', '🔥']} />)
    expect(screen.getByRole('tab', { name: 'Emoji' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Color' }))
    expect(value()).toEqual({ kind: 'emoji', emoji: '📅', show: 'color' })
    fireEvent.click(screen.getByRole('button', { name: 'Emoji 🔥' }))
    expect(value()).toEqual({ kind: 'emoji', emoji: '🔥', show: 'color' })
  })

  it('shows no Recent while nothing is used', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Emoji' }))
    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('No icon stores none and closes', () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: 'No icon' }))
    expect(onPick).toHaveBeenCalledWith({ kind: 'none' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Esc closes it and hands the focus back to the opener', () => {
    render(<Harness />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus()
  })
})

describe('emojiFieldHint (J8)', () => {
  it('names the platform’s shortcut', () => {
    expect(emojiFieldHint({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0 })).toBe('Win + . to pick an emoji, or paste one')
    expect(emojiFieldHint({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe('⌃⌘Space to pick an emoji, or paste one')
    expect(emojiFieldHint({ userAgent: 'Mozilla/5.0 (X11; Linux)', platform: 'Linux x86_64', maxTouchPoints: 0 })).toBe('Paste an emoji')
  })
})
