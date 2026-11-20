import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, createEvent } from '@testing-library/react'
import { RemoveButton } from '../../../components/shared/RemoveButton'
import { DialogCloseButton } from '../../../components/shared/DialogCloseButton'

afterEach(cleanup)

describe('RemoveButton', () => {
  it('is a button named by its label, drawing the × icon (no text)', () => {
    render(<RemoveButton label="Remove Aisha" onClick={() => {}} />)
    const button = screen.getByRole('button', { name: 'Remove Aisha' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.textContent).toBe('')
    expect(button.hasAttribute('data-tooltip')).toBe(false)
  })

  it('tooltip: true shows the label, a string shows that text', () => {
    render(
      <>
        <RemoveButton label="Clear due date" tooltip />
        <RemoveButton label="Clear next follow-up" tooltip="Clear the date" />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Clear due date' }).getAttribute('data-tooltip')).toBe('Clear due date')
    expect(screen.getByRole('button', { name: 'Clear next follow-up' }).getAttribute('data-tooltip')).toBe('Clear the date')
  })

  it('keepFocus prevents the mousedown default (the focus stays where it is); without it the default goes ahead', () => {
    const onMouseDown = vi.fn()
    render(
      <>
        <RemoveButton label="Keeps" keepFocus onMouseDown={onMouseDown} />
        <RemoveButton label="Moves" />
      </>,
    )
    const keeps = screen.getByRole('button', { name: 'Keeps' })
    const down = createEvent.mouseDown(keeps)
    fireEvent(keeps, down)
    expect(down.defaultPrevented).toBe(true)
    expect(onMouseDown).toHaveBeenCalledOnce()

    const moves = screen.getByRole('button', { name: 'Moves' })
    const down2 = createEvent.mouseDown(moves)
    fireEvent(moves, down2)
    expect(down2.defaultPrevented).toBe(false)
  })

  it('stopPropagation keeps the click from its pill', () => {
    const onPill = vi.fn()
    const onRemove = vi.fn()
    render(
      <span onClick={onPill}>
        <RemoveButton label="Remove filter" stopPropagation onClick={onRemove} />
      </span>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter' }))
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onPill).not.toHaveBeenCalled()
  })

  it('as="span": a role="button" span, not a Tab stop, inside another button', () => {
    const onClick = vi.fn()
    render(<button type="button">Due 11/20 <RemoveButton as="span" label="Clear due date" onClick={onClick} /></button>)
    const clear = screen.getByRole('button', { name: 'Clear due date' })
    expect(clear.tagName).toBe('SPAN')
    expect(clear.getAttribute('tabindex')).toBe('-1')
    expect(clear.querySelector('svg')).not.toBeNull()
    fireEvent.click(clear)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('passes data attributes and the host class through', () => {
    render(<RemoveButton label="Clear" className="host" data-row-cell="due" />)
    const button = screen.getByRole('button', { name: 'Clear' })
    expect(button.getAttribute('data-row-cell')).toBe('due')
    expect(button.className).toContain('host')
  })
})

describe('DialogCloseButton', () => {
  it('is named Close by default and draws the × icon', () => {
    const onClick = vi.fn()
    render(<DialogCloseButton onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Close' })
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.textContent).toBe('')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('takes its own name and tooltip', () => {
    render(<DialogCloseButton label="Close Edit list" tooltip="Close" />)
    expect(screen.getByRole('button', { name: 'Close Edit list' }).getAttribute('data-tooltip')).toBe('Close')
  })
})
