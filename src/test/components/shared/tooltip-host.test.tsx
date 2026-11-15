import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'
import { TooltipHost } from '../../../components/shared/TooltipHost'
import { TOOLTIP_DELAY_MS } from '../../../components/shared/use-tooltip'

/**
 * One tooltip everywhere (flair P9): any `data-tooltip` element shows the
 * app's tooltip after the delay — not for touch, gone on a press or when the
 * pointer leaves, the trigger described by it while it shows.
 */

function setup() {
  render(
    <>
      <TooltipHost />
      <button type="button" data-tooltip="Settings" data-tooltip-shortcut="G S" aria-describedby="own">
        <span data-testid="inner">⚙</span>
      </button>
      <button type="button">No tooltip</button>
    </>,
  )
  return screen.getByRole('button', { name: '⚙' })
}

const pointer = (type: 'pointerOver' | 'pointerOut', el: Element, init: Record<string, unknown> = {}) =>
  fireEvent[type](el, { pointerType: 'mouse', bubbles: true, ...init })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TooltipHost', () => {
  it('a hover shows the tooltip after the delay, with its shortcut; the trigger is described by it beside its own ids', () => {
    const button = setup()
    pointer('pointerOver', screen.getByTestId('inner'))
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 10) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(20) })
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Settings')
    expect(tip).toHaveTextContent('G S')
    expect(button.getAttribute('aria-describedby')?.split(' ')).toEqual(['own', tip.id])
  })

  it('moving onto a child keeps it; leaving the trigger closes it and gives back its own description', () => {
    const button = setup()
    pointer('pointerOver', button)
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
    pointer('pointerOut', button, { relatedTarget: screen.getByTestId('inner') })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    pointer('pointerOut', button, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button).toHaveAttribute('aria-describedby', 'own')
  })

  it('a press closes it; touch never opens it; an element without the attribute has none', () => {
    const button = setup()
    pointer('pointerOver', button)
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
    fireEvent.pointerDown(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
    pointer('pointerOver', button, { pointerType: 'touch' })
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    pointer('pointerOver', screen.getByRole('button', { name: 'No tooltip' }))
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('the trigger leaving the page takes its tooltip with it', async () => {
    const page = (shown: boolean) => (
      <>
        <TooltipHost />
        {shown && <button type="button" data-tooltip="Goes away">x</button>}
      </>
    )
    const { rerender } = render(page(true))
    pointer('pointerOver', screen.getByRole('button', { name: 'x' }))
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    rerender(page(false))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
