import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Dialog, DialogActions, DialogBody, DialogFrame, ConfirmDialog } from '../../../components/shared/Dialog'

afterEach(() => cleanup())

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} onClose={() => {}} title="T">
        <p>hidden</p>
      </Dialog>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('hidden')).toBeNull()
  })

  it('renders title + body and exposes role/aria-modal/aria-labelledby', () => {
    render(
      <Dialog open onClose={() => {}} title="My title">
        <DialogBody>Body text</DialogBody>
      </Dialog>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby')
    const titleId = dialog.getAttribute('aria-labelledby')!
    const titleEl = document.getElementById(titleId)
    expect(titleEl).not.toBeNull()
    expect(titleEl).toHaveTextContent('My title')
    expect(screen.getByText('Body text')).toBeInTheDocument()
  })

  it('autoFocuses the first focusable element on mount', () => {
    render(
      <Dialog open onClose={() => {}} title="T">
        <DialogActions>
          <button>One</button>
          <button>Two</button>
        </DialogActions>
      </Dialog>
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'One' }))
  })

  it('autoFocuses initialFocusRef when provided', () => {
    function Harness() {
      const ref = useRef<HTMLButtonElement>(null)
      return (
        <Dialog open onClose={() => {}} title="T" initialFocusRef={ref}>
          <DialogActions>
            <button>First</button>
            <button ref={ref}>Primary</button>
          </DialogActions>
        </Dialog>
      )
    }
    render(<Harness />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Primary' }))
  })

  it('calls onClose on Escape from inside the panel', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T">
        <button>Inside</button>
      </Dialog>
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inside' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on Escape with nothing focused', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T">
        <button>Inside</button>
      </Dialog>
    )
    act(() => (document.activeElement as HTMLElement).blur())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves an Escape a control inside already handled', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T">
        <input aria-label="Field" onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault() }} />
      </Dialog>
    )
    fireEvent.keyDown(screen.getByLabelText('Field'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders into document.body (or in place with `inline`)', () => {
    const { container, rerender } = render(
      <div data-host="">
        <Dialog open onClose={() => {}} title="T"><p>hi</p></Dialog>
      </div>
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(screen.getByRole('dialog').parentElement).toBe(document.body)
    rerender(
      <div data-host="">
        <Dialog open inline onClose={() => {}} title="T"><p>hi</p></Dialog>
      </div>
    )
    expect(container.querySelector('[data-host] [role="dialog"]')).not.toBeNull()
  })

  it('marks the panel as a modal shortcut scope', () => {
    render(<Dialog open onClose={() => {}} title="T"><p>hi</p></Dialog>)
    expect(screen.getByRole('dialog').getAttribute('data-shortcut-scope')).toBe('modal')
  })

  it('closes on a press that starts and ends on the backdrop', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T">
        <p>hi</p>
      </Dialog>
    )
    const backdrop = document.querySelector('[data-dialog-backdrop]')!
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when a press inside the panel ends on the backdrop', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T">
        <p>hi</p>
      </Dialog>
    )
    fireEvent.mouseDown(screen.getByText('hi'))
    // The browser fires the click on the common ancestor; a backdrop click
    // without its own press is what a drag out of the panel looks like here.
    fireEvent.click(document.querySelector('[data-dialog-backdrop]')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not call onClose on a backdrop press when blockBackdropClose is set', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T" blockBackdropClose>
        <p>hi</p>
      </Dialog>
    )
    const backdrop = document.querySelector('[data-dialog-backdrop]')!
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('traps Tab focus inside the dialog (last → first)', () => {
    render(
      <Dialog open onClose={() => {}} title="T">
        <DialogActions>
          <button>One</button>
          <button>Two</button>
        </DialogActions>
      </Dialog>
    )
    const one = screen.getByRole('button', { name: 'One' })
    const two = screen.getByRole('button', { name: 'Two' })
    two.focus()
    expect(document.activeElement).toBe(two)
    fireEvent.keyDown(two, { key: 'Tab' })
    expect(document.activeElement).toBe(one)
  })

  it('traps Shift+Tab focus inside the dialog (first → last)', () => {
    render(
      <Dialog open onClose={() => {}} title="T">
        <DialogActions>
          <button>One</button>
          <button>Two</button>
        </DialogActions>
      </Dialog>
    )
    const one = screen.getByRole('button', { name: 'One' })
    const two = screen.getByRole('button', { name: 'Two' })
    one.focus()
    fireEvent.keyDown(one, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(two)
  })

  it('brings Tab with nothing focused back into the dialog', () => {
    render(
      <Dialog open onClose={() => {}} title="T">
        <DialogActions>
          <button>One</button>
          <button>Two</button>
        </DialogActions>
      </Dialog>
    )
    act(() => (document.activeElement as HTMLElement).blur())
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Two' }))
  })
})

describe('DialogFrame stacking', () => {
  it('Esc with nothing focused closes only the topmost dialog', () => {
    const lower = vi.fn()
    const upper = vi.fn()
    render(
      <>
        <DialogFrame onClose={lower} aria-label="Lower"><button>L</button></DialogFrame>
        <DialogFrame onClose={upper} layer="nested" aria-label="Upper"><button>U</button></DialogFrame>
      </>
    )
    act(() => (document.activeElement as HTMLElement).blur())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(upper).toHaveBeenCalledTimes(1)
    expect(lower).not.toHaveBeenCalled()
  })

  it('an Esc in a dialog rendered inside another closes only the inner one', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <DialogFrame onClose={outer} aria-label="Outer">
        <button>O</button>
        <DialogFrame onClose={inner} layer="nested" aria-label="Inner"><button>I</button></DialogFrame>
      </DialogFrame>
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'I' }), { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('escapeBelongsElsewhere keeps it open, focused or not', () => {
    const onClose = vi.fn()
    let layerOpen = true
    render(
      <DialogFrame onClose={onClose} escapeBelongsElsewhere={() => layerOpen} aria-label="D">
        <button>B</button>
      </DialogFrame>
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'B' }), { key: 'Escape' })
    act(() => (document.activeElement as HTMLElement).blur())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    layerOpen = false
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves keys from a layer portaled out of the panel to that layer', () => {
    const onClose = vi.fn()
    function Layer() {
      return createPortal(<input aria-label="Layer field" />, document.body)
    }
    render(
      <DialogFrame onClose={onClose} aria-label="D">
        <button>B</button>
        <Layer />
      </DialogFrame>
    )
    fireEvent.keyDown(screen.getByLabelText('Layer field'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('initialFocus="panel" focuses the panel itself', () => {
    render(
      <DialogFrame onClose={() => {}} initialFocus="panel" aria-label="D">
        <button>B</button>
      </DialogFrame>
    )
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'D' }))
  })
})

describe('Dialog focus return', () => {
  it('restores focus to the previously focused element on unmount', () => {
    function Harness() {
      const triggerRef = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button ref={triggerRef}>Trigger</button>
          <Dialog open onClose={() => {}} title="T">
            <button>Inside</button>
          </Dialog>
        </>
      )
    }
    const trigger = document.createElement('button')
    trigger.textContent = 'Outside'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = render(<Harness />)
    expect(document.activeElement).not.toBe(trigger)
    act(() => {
      unmount()
    })
    expect(document.activeElement).toBe(trigger)
    document.body.removeChild(trigger)
  })
})

describe('ConfirmDialog', () => {
  it('autoFocuses the confirm button', () => {
    render(
      <ConfirmDialog
        open
        title="Confirm"
        message="Sure?"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes' }))
  })

  it('routes Esc to onCancel', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open
        title="Confirm"
        message="Sure?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders danger styling when danger=true', () => {
    render(
      <ConfirmDialog
        open
        title="Confirm"
        message="Sure?"
        confirmLabel="Delete"
        danger
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    const confirmBtn = screen.getByRole('button', { name: 'Delete' })
    // CSS module hash is opaque, but the class string should contain the
    // canonical key 'dangerButton'.
    expect(confirmBtn.className).toMatch(/dangerButton/)
  })
})
