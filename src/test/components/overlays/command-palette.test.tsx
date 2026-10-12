import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { CommandPalette } from '../../../components/overlays/CommandPalette'
import type { Command } from '../../../services/command-registry'

// JSDOM has no scrollIntoView (the palette keeps the active row in view).
const proto = Element.prototype as { scrollIntoView?: unknown }
let originalScrollIntoView: unknown

beforeEach(() => {
  originalScrollIntoView = proto.scrollIntoView
  proto.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  if (originalScrollIntoView === undefined) delete proto.scrollIntoView
  else proto.scrollIntoView = originalScrollIntoView
})

describe('CommandPalette', () => {
  it('shows a command’s hint on the right of its row, and the Email section groups the check-in commands', () => {
    const open = vi.fn()
    const commands: Command[] = [
      { id: 'email-checkins', name: 'Email task check-ins…', hint: 'choose people', category: 'email', action: vi.fn() },
      { id: 'email-checkin-2', name: 'Email check-in: Ada Lovelace', hint: '4 open tasks', category: 'email', action: open },
    ]
    const onClose = vi.fn()
    render(<CommandPalette commands={commands} onClose={onClose} />)
    const section = screen.getByRole('group', { name: 'Email' })
    const row = screen.getByRole('option', { name: /Email check-in: Ada Lovelace/ })
    expect(section).toContainElement(row)
    expect(row).toHaveTextContent('4 open tasks')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('option', { name: /Ada Lovelace/ }))
    expect(open).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
