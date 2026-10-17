import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { SettingsModal } from '../../../components/settings/SettingsModal'
import { useUIStore } from '../../../stores/ui-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { db } from '../../../data/database'

beforeEach(() => {
  vi.stubGlobal('navigator', { platform: 'Win32' } as Navigator)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function openShortcuts() {
  render(<SettingsModal />)
  act(() => useUIStore.getState().openSettings('shortcuts'))
}

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-shortcut-id="${id}"]`)
  if (!el) throw new Error(`no row ${id}`)
  return el
}

const keysOf = (id: string) => row(id).querySelector('kbd')?.textContent

function startRecording(description: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: `Change keys for ${description}` }))
  const capture = screen.getByRole('textbox', { name: `New keys for ${description}` })
  expect(capture).toHaveFocus()
  return capture
}

describe('Settings › Keyboard shortcuts editor', () => {
  it('records a new combo, shows it as changed, and resets it', async () => {
    openShortcuts()
    expect(keysOf('command-palette')).toBe('Ctrl+K')
    const capture = startRecording('Command Palette')
    fireEvent.keyDown(capture, { key: 'Control', ctrlKey: true })
    fireEvent.keyDown(capture, { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(keysOf('command-palette')).toBe('Ctrl+Shift+P'))
    expect(screen.getByRole('button', { name: 'Change keys for Command Palette' })).toHaveFocus()
    expect((await db.settings.get('keyboardShortcuts'))?.value).toBe('{"command-palette":"Mod-Shift-p"}')

    fireEvent.click(screen.getByRole('button', { name: 'Reset Command Palette to Ctrl+K' }))
    await waitFor(() => expect(keysOf('command-palette')).toBe('Ctrl+K'))
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({})
  })

  it('refuses keys another shortcut uses, saying which, and keeps recording', async () => {
    openShortcuts()
    const capture = startRecording('Focus filters')
    fireEvent.keyDown(capture, { key: 'k', code: 'KeyK', ctrlKey: true })
    expect(await screen.findByRole('alert')).toHaveTextContent('Ctrl+K is already used by Command Palette.')
    expect(capture).toHaveFocus()
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({})
  })

  it('refuses a browser key', async () => {
    openShortcuts()
    const capture = startRecording('Undo')
    fireEvent.keyDown(capture, { key: 'w', code: 'KeyW', ctrlKey: true })
    expect(await screen.findByRole('alert')).toHaveTextContent('Ctrl+W is used by the browser (Close tab).')
  })

  it('records a two-key sequence, or a plain key alone with Enter', async () => {
    openShortcuts()
    let capture = startRecording('Open Settings')
    fireEvent.keyDown(capture, { key: 'g', code: 'KeyG' })
    expect(capture).toHaveTextContent('G … then a second key, or Enter for G alone')
    fireEvent.keyDown(capture, { key: 'o', code: 'KeyO' })
    await waitFor(() => expect(keysOf('open-settings')).toBe('G then O'))

    capture = startRecording('Focus filters')
    fireEvent.keyDown(capture, { key: 'n', code: 'KeyN' })
    fireEvent.keyDown(capture, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(keysOf('focus-filters')).toBe('N'))
  })

  it('Esc cancels the recording and leaves Settings open', () => {
    openShortcuts()
    const capture = startRecording('Command Palette')
    fireEvent.keyDown(capture, { key: 'Escape', code: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'New keys for Command Palette' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(keysOf('command-palette')).toBe('Ctrl+K')
  })

  it('lists fixed keys without Change', () => {
    openShortcuts()
    expect(screen.getByText('Close overlay / Clear selection')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change keys for Close overlay / Clear selection' })).toBeNull()
    expect(screen.getByText('Convert current line to task')).toBeInTheDocument()
  })

  it('Reset all asks first, then puts every shortcut back', async () => {
    useSettingsStore.setState({ shortcutOverrides: { 'focus-filters': [{ key: 'n' }] } })
    openShortcuts()
    expect(keysOf('focus-filters')).toBe('N')
    fireEvent.click(screen.getByRole('button', { name: 'Reset all…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reset all' }))
    await waitFor(() => expect(keysOf('focus-filters')).toBe('F'))
    expect(screen.getByRole('button', { name: 'Reset all…' })).toBeDisabled()
  })
})
