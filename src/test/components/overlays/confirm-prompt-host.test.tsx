import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ConfirmPromptHost } from '../../../components/overlays/ConfirmPromptHost'
import { useUIStore, type ConfirmPrompt } from '../../../stores/ui-store'

const NO_BACKUP: ConfirmPrompt = {
  title: 'Continue without a backup?',
  message: 'A backup could not be saved.',
  confirmLabel: 'Continue',
  danger: true,
  cancelIsDefault: true,
}

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState(), true)
})

afterEach(() => cleanup())

function ask(prompt: ConfirmPrompt): Promise<boolean> {
  let answer!: Promise<boolean>
  act(() => { answer = useUIStore.getState().askConfirmation(prompt) })
  return answer
}

describe('ConfirmPromptHost', () => {
  it('renders nothing without a question', () => {
    render(<ConfirmPromptHost />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('focuses Cancel when it is the default; Continue resolves true', async () => {
    render(<ConfirmPromptHost />)
    const answer = ask(NO_BACKUP)
    const dialog = screen.getByRole('dialog', { name: 'Continue without a backup?' })
    expect(dialog).toHaveTextContent('A backup could not be saved.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await answer).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Escape answers Cancel', async () => {
    render(<ConfirmPromptHost />)
    const answer = ask(NO_BACKUP)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(await answer).toBe(false)
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
  })

  it('a question queued behind the one on screen leaves it as it is: same dialog, the focus where it was, then back to the opener', async () => {
    render(<><button type="button">Opener</button><ConfirmPromptHost /></>)
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    const first = ask(NO_BACKUP)
    const dialog = screen.getByRole('dialog', { name: 'Continue without a backup?' })
    screen.getByRole('button', { name: 'Continue' }).focus()
    const second = ask({ ...NO_BACKUP, title: 'Did the file save?', confirmLabel: 'Delete 2 tasks' })
    expect(screen.getByRole('dialog', { name: 'Continue without a backup?' })).toBe(dialog)
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus()
    // Two questions with the same title still get a dialog each.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await first).toBe(true)
    expect(screen.getByRole('dialog', { name: 'Did the file save?' })).not.toBe(dialog)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await second).toBe(false)
    expect(opener).toHaveFocus()
  })

  it('shows queued questions one after another', async () => {
    render(<ConfirmPromptHost />)
    const first = ask(NO_BACKUP)
    const second = ask({ ...NO_BACKUP, title: 'Did the file save?', confirmLabel: 'Delete 2 tasks' })
    expect(screen.getByRole('dialog', { name: 'Continue without a backup?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await first).toBe(false)
    expect(screen.getByRole('dialog', { name: 'Did the file save?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 tasks' }))
    expect(await second).toBe(true)
  })
})
