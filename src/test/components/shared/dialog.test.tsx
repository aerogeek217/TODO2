import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useRef } from 'react'
import { Dialog, DialogActions, DialogBody, ConfirmDialog } from '../../../components/shared/Dialog'

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

  it('calls onClose on Escape', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="T">
        <button>Inside</button>
      </Dialog>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on backdrop click by default', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Dialog open onClose={onClose} title="T">
        <p>hi</p>
      </Dialog>
    )
    const backdrop = container.querySelector('div')!
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose on backdrop click when blockBackdropClose is set', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Dialog open onClose={onClose} title="T" blockBackdropClose>
        <p>hi</p>
      </Dialog>
    )
    const backdrop = container.querySelector('div')!
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
    fireEvent.keyDown(document, { key: 'Tab' })
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
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(two)
  })

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
