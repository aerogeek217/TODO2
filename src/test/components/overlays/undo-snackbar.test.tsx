import { describe, it, expect, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { UndoSnackbar } from '../../../components/overlays/UndoSnackbar'
import { useUndoStore } from '../../../stores/undo-store'
import { readFileSync } from 'node:fs'

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

describe('the editor’s Delete hover (cr31 T15)', () => {
  it('takes the danger tokens, not the dark theme’s literal tint', () => {
    const taskEditCss = readFileSync('src/components/task/TaskEditPopup.module.css', 'utf8')
    const rule = taskEditCss.match(/\.deleteButton:hover\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('var(--color-danger-ring)')
    expect(rule).not.toMatch(/rgba\(/)
  })
})
