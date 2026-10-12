import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within, waitFor } from '@testing-library/react'
import { SettingsModal } from '../../../components/settings/SettingsModal'
import { useUIStore } from '../../../stores/ui-store'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState(), true)
  usePersonStore.setState(usePersonStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

afterEach(cleanup)

function open(section?: Parameters<ReturnType<typeof useUIStore.getState>['openSettings']>[0]) {
  act(() => useUIStore.getState().openSettings(section))
}

function sectionHeading() {
  return screen.getByRole('dialog', { name: 'Settings' }).querySelector('h2')?.textContent
}

describe('SettingsModal', () => {
  it('renders nothing while closed', () => {
    render(<SettingsModal />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens on Appearance, with the theme control', () => {
    render(<SettingsModal />)
    open()
    expect(sectionHeading()).toBe('Appearance')
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'true')
  })

  it('shows one section at a time and reopens on the last one viewed', () => {
    render(<SettingsModal />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'File storage' }))
    expect(sectionHeading()).toBe('File storage')
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    open()
    expect(sectionHeading()).toBe('File storage')
  })

  it('opens on a given section', () => {
    render(<SettingsModal />)
    open('import-export')
    expect(sectionHeading()).toBe('Import / Export')
    expect(useUIStore.getState().settingsSection).toBe('import-export')
  })

  it('Esc and a backdrop click close it', () => {
    render(<SettingsModal />)
    open()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useUIStore.getState().settingsOpen).toBe(false)
    open()
    fireEvent.click(screen.getByTestId('settings-backdrop'))
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('a click inside the frame does not close it', () => {
    render(<SettingsModal />)
    open()
    fireEvent.click(screen.getByRole('dialog', { name: 'Settings' }))
    expect(useUIStore.getState().settingsOpen).toBe(true)
  })

  it('Esc belongs to an editor opened over it', () => {
    render(<SettingsModal />)
    open('entities')
    fireEvent.click(screen.getByRole('button', { name: 'Manage people…' }))
    expect(screen.getByText('People', { selector: 'div' })).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useUIStore.getState().settingsOpen).toBe(true)
  })

  it('Esc is left to the lists editor while it is open over the modal', () => {
    render(<SettingsModal />)
    open('entities')
    act(() => useUIStore.getState().openListsEditor())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useUIStore.getState().settingsOpen).toBe(true)
  })

  it('the theme control sets the theme mode', async () => {
    render(<SettingsModal />)
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    await waitFor(() => expect(useSettingsStore.getState().themeMode).toBe('light'))
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
  })
})
