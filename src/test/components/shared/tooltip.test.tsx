import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Tooltip } from '../../../components/shared/Tooltip'
import { TOOLTIP_DELAY_MS, useTooltip } from '../../../components/shared/use-tooltip'

function Trigger({ text, shortcut }: { text: string | null; shortcut?: string }) {
  const { triggerProps, tooltip } = useTooltip(text, { shortcut })
  return <button type="button" {...triggerProps}>Copy{tooltip}</button>
}

describe('useTooltip / <Tooltip> — the app tooltip', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('opens after 400 ms of hover, not before, and closes on leave', () => {
    expect(TOOLTIP_DELAY_MS).toBe(400)
    render(<Trigger text="Copy tasks" />)
    const btn = screen.getByRole('button', { name: 'Copy' })
    fireEvent.pointerEnter(btn)
    act(() => { vi.advanceTimersByTime(399) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(btn).not.toHaveAttribute('aria-describedby')
    act(() => { vi.advanceTimersByTime(1) })
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Copy tasks')
    expect(btn).toHaveAttribute('aria-describedby', tip.id)
    fireEvent.pointerLeave(btn)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('leaving before the delay cancels it', () => {
    render(<Trigger text="Copy tasks" />)
    const btn = screen.getByRole('button', { name: 'Copy' })
    fireEvent.pointerEnter(btn)
    act(() => { vi.advanceTimersByTime(200) })
    fireEvent.pointerLeave(btn)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('a press, Escape or a scroll closes it', () => {
    render(<Trigger text="Copy tasks" />)
    const btn = screen.getByRole('button', { name: 'Copy' })
    const open = () => {
      fireEvent.pointerEnter(btn)
      act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
    }
    open()
    fireEvent.pointerDown(btn)
    expect(screen.queryByRole('tooltip')).toBeNull()
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    open()
    fireEvent.scroll(window)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('touch never opens it', () => {
    render(<Trigger text="Copy tasks" />)
    const btn = screen.getByRole('button', { name: 'Copy' })
    // jsdom has no PointerEvent: give the event its pointer type by hand.
    const ev = new MouseEvent('pointerover', { bubbles: true })
    Object.defineProperty(ev, 'pointerType', { value: 'touch' })
    act(() => { btn.dispatchEvent(ev) })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    // The same event from a mouse does (so the touch check is what stopped it).
    act(() => { btn.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })) })
    const mouse = new MouseEvent('pointerover', { bubbles: true })
    Object.defineProperty(mouse, 'pointerType', { value: 'mouse' })
    act(() => { btn.dispatchEvent(mouse) })
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('multi-line text: the first line is the label, the rest muted lines; shortcut variant', () => {
    render(<Trigger text={'Next follow-up · Tue 13 Oct\nLast followed up Sun 13 Sep, 4 weeks ago'} />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Copy' }))
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
    const tip = screen.getByRole('tooltip')
    expect(Array.from(tip.children).map((c) => c.textContent))
      .toEqual(['Next follow-up · Tue 13 Oct', 'Last followed up Sun 13 Sep, 4 weeks ago'])
    cleanup()
    render(<Trigger text="Complete" shortcut="Space" />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Copy' }))
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Complete Space')
  })

  it('no text: no handlers, nothing opens; <Tooltip> wraps any content', () => {
    render(<Trigger text={null} />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Copy' }))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    cleanup()
    render(<Tooltip text="Important" role="img" aria-label="Important">★</Tooltip>)
    fireEvent.pointerEnter(screen.getByRole('img', { name: 'Important' }))
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Important')
  })
})
