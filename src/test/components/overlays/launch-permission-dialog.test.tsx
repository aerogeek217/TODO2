import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LaunchPermissionDialog } from '../../../components/overlays/LaunchPermissionDialog'
import { useFileStorageStore, type LaunchPermissionPrompt } from '../../../services/file-storage-store'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function show(phase: LaunchPermissionPrompt['phase']) {
  const grant = vi.fn()
  const continueWithout = vi.fn()
  useFileStorageStore.setState({ grantLaunchPermission: grant, continueWithoutFile: continueWithout })
  const view = render(<LaunchPermissionDialog prompt={{ fileName: 'todo2.json', phase }} />)
  return { grant, continueWithout, ...view }
}

describe('LaunchPermissionDialog', () => {
  it('asks: title, body and both answers explained; Grant access… focused', () => {
    const { grant } = show('ask')
    const dialog = screen.getByRole('dialog', { name: 'Allow access to todo2.json' })
    expect(dialog).toHaveAccessibleDescription(/TODO2 syncs your tasks with todo2\.json\. After a browser restart/)
    expect(dialog).toHaveTextContent('Grant access')
    expect(dialog).toHaveTextContent('Sync stays paused and nothing is written to todo2.json')
    const primary = screen.getByRole('button', { name: 'Grant access…' })
    expect(primary).toHaveFocus()
    fireEvent.click(primary)
    expect(grant).toHaveBeenCalledTimes(1)
  })

  it('Esc and Continue without the file both continue; a backdrop press does nothing', () => {
    const { continueWithout, baseElement } = show('ask')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Grant access…' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /Continue without the file/ }))
    const backdrop = baseElement.querySelector('[data-dialog-backdrop]')!
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(continueWithout).toHaveBeenCalledTimes(2)
  })

  it('waiting: the status line, the primary disabled, Continue still there', () => {
    const { continueWithout } = show('waiting')
    expect(screen.getByRole('status')).toHaveTextContent('Answer the prompt your browser shows to allow access.')
    expect(screen.getByRole('button', { name: 'Waiting for your browser…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Continue without the file/ }))
    expect(continueWithout).toHaveBeenCalledTimes(1)
  })

  it('refused: the notice, and Try again focused', () => {
    const { grant } = show('refused')
    expect(screen.getByRole('alert')).toHaveTextContent('Your browser didn’t allow access.')
    const retry = screen.getByRole('button', { name: 'Try again' })
    expect(retry).toHaveFocus()
    fireEvent.click(retry)
    expect(grant).toHaveBeenCalledTimes(1)
  })
})
