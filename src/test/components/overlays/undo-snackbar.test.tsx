import { describe, it, expect, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { UndoSnackbar } from '../../../components/overlays/UndoSnackbar'
import { useUndoStore } from '../../../stores/undo-store'

afterEach(cleanup)

describe('UndoSnackbar (cr31 T13)', () => {
  it('announces its message through a live region that is there before the message', () => {
    render(<UndoSnackbar />)
    const live = screen.getByRole('status')
    expect(live).toHaveAttribute('aria-live', 'polite')
    // Mounted before any message, empty.
    expect(live.textContent).toBe('')
    act(() => { useUndoStore.setState({ snackbar: { description: 'Complete "Draft OKRs"', detail: 'and 2 more' } }) })
    // The same element, now holding the message.
    expect(screen.getByRole('status')).toBe(live)
    expect(live.textContent).toContain('Complete "Draft OKRs"')
    expect(live.textContent).toContain('and 2 more')
  })
})
