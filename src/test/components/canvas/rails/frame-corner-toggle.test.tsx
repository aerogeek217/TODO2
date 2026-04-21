import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { FrameCornerToggle } from '../../../../components/canvas/rails/FrameCornerToggle'
import type { RailsState, Slot } from '../../../../models/canvas-rails'
import { EMPTY_RAILS } from '../../../../models/canvas-rails'

afterEach(() => cleanup())

function slot(id: string): Slot {
  return { id, tabs: [{ id: `${id}-t0`, type: 'lens' }], activeTabId: `${id}-t0` }
}

function railsWithSides(sides: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }): RailsState {
  return {
    ...EMPTY_RAILS,
    left: sides.left ? { orientation: 'vertical', slots: [slot('L')] } : null,
    right: sides.right ? { orientation: 'vertical', slots: [slot('R')] } : null,
    top: sides.top ? { orientation: 'horizontal', slots: [slot('T')] } : null,
    bottom: sides.bottom ? { orientation: 'horizontal', slots: [slot('B')] } : null,
  }
}

describe('FrameCornerToggle', () => {
  it('is disabled when an adjacent rail is missing', () => {
    const rails = railsWithSides({ left: true }) // top is null → nw disabled
    render(
      <FrameCornerToggle
        corner="nw"
        rails={rails}
        onToggle={() => {}}
        onArrowNav={() => {}}
        tabIndex={0}
      />,
    )
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-disabled', 'true')
  })

  it('toggles from v → h when both adjacent rails exist and corner defaults to v', () => {
    const rails = railsWithSides({ left: true, top: true })
    const onToggle = vi.fn()
    render(
      <FrameCornerToggle
        corner="nw"
        rails={rails}
        onToggle={onToggle}
        onArrowNav={() => {}}
        tabIndex={0}
      />,
    )
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledWith('nw', 'h')
  })

  it('toggles from h → v when the stored owner is h', () => {
    const rails: RailsState = { ...railsWithSides({ left: true, top: true }), corners: { nw: 'h' } }
    const onToggle = vi.fn()
    render(
      <FrameCornerToggle
        corner="nw"
        rails={rails}
        onToggle={onToggle}
        onArrowNav={() => {}}
        tabIndex={0}
      />,
    )
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledWith('nw', 'v')
  })

  it('does not fire onToggle when disabled', () => {
    const rails = railsWithSides({ left: true }) // top null
    const onToggle = vi.fn()
    render(
      <FrameCornerToggle
        corner="nw"
        rails={rails}
        onToggle={onToggle}
        onArrowNav={() => {}}
        tabIndex={0}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('fires onArrowNav for arrow keys and preventDefault', () => {
    const rails = railsWithSides({ left: true, right: true, top: true, bottom: true })
    const onArrow = vi.fn()
    render(
      <FrameCornerToggle
        corner="nw"
        rails={rails}
        onToggle={() => {}}
        onArrowNav={onArrow}
        tabIndex={0}
      />,
    )
    const btn = screen.getByRole('button')
    fireEvent.keyDown(btn, { key: 'ArrowRight' })
    fireEvent.keyDown(btn, { key: 'ArrowDown' })
    fireEvent.keyDown(btn, { key: 'Enter' }) // ignored by onArrowNav
    expect(onArrow).toHaveBeenCalledTimes(2)
    expect(onArrow).toHaveBeenNthCalledWith(1, 'nw', 'ArrowRight')
    expect(onArrow).toHaveBeenNthCalledWith(2, 'nw', 'ArrowDown')
  })

  it('forwards ref to the button element', () => {
    const rails = railsWithSides({ left: true, top: true })
    const ref = createRef<HTMLButtonElement>()
    render(
      <FrameCornerToggle
        ref={ref}
        corner="nw"
        rails={rails}
        onToggle={() => {}}
        onArrowNav={() => {}}
        tabIndex={0}
      />,
    )
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })

  it('respects the passed tabIndex (roving focus)', () => {
    const rails = railsWithSides({ left: true, top: true, right: true, bottom: true })
    render(
      <>
        <FrameCornerToggle corner="nw" rails={rails} onToggle={() => {}} onArrowNav={() => {}} tabIndex={0} />
        <FrameCornerToggle corner="ne" rails={rails} onToggle={() => {}} onArrowNav={() => {}} tabIndex={-1} />
      </>,
    )
    const [nw, ne] = screen.getAllByRole('button')
    expect(nw).toHaveAttribute('tabindex', '0')
    expect(ne).toHaveAttribute('tabindex', '-1')
  })
})
