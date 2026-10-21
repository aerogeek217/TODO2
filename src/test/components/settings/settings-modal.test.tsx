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

  it('lists Appearance, Tasks, People statuses & tags, Database, Keyboard shortcuts, About', () => {
    render(<SettingsModal />)
    open()
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Appearance', 'Tasks', 'People, statuses & tags', 'Database', 'Keyboard shortcuts', 'About'])
  })

  it('shows one section at a time and reopens on the last one viewed', () => {
    render(<SettingsModal />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Database' }))
    expect(sectionHeading()).toBe('Database')
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    open()
    expect(sectionHeading()).toBe('Database')
  })

  it('Tasks holds Task defaults, Eisenhower, then Completed tasks; Database Import / Export, Data integrity, File storage, Backups — each headed', () => {
    render(<SettingsModal />)
    open('tasks')
    const parts = () => Array.from(screen.getByRole('dialog', { name: 'Settings' }).querySelectorAll('h3')).map((h) => h.textContent)
    expect(parts()).toEqual(['Task defaults', 'Eisenhower', 'Completed tasks'])
    expect(screen.getByRole('region', { name: 'Completed tasks' })).toHaveAttribute('data-settings-part', 'completed')
    fireEvent.click(screen.getByRole('button', { name: 'Database' }))
    expect(parts()).toEqual(['Import / Export', 'Data integrity', 'File storage', 'Backups'])
  })

  it('a deep link to a part opens its section (the old section ids still work)', () => {
    render(<SettingsModal />)
    open('import-export')
    expect(sectionHeading()).toBe('Database')
    expect(useUIStore.getState().settingsSection).toBe('database')
    // Shown: the part is forgotten, so reopening later doesn't jump again.
    expect(useUIStore.getState().settingsPart).toBeNull()
    act(() => useUIStore.getState().closeSettings())
    open('completed')
    expect(sectionHeading()).toBe('Tasks')
  })

  it('Esc and a backdrop click close it', () => {
    render(<SettingsModal />)
    open()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useUIStore.getState().settingsOpen).toBe(false)
    open()
    const backdrop = document.querySelector('[data-dialog-backdrop]')!
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it.each([
    ['Follow-up interval', '2w'],
    ['Ask at most every (days)', '30'],
  ])('Esc in the %s field reverts a changed draft and keeps Settings open; a second Esc closes it', (name, typed) => {
    useSettingsStore.setState({ completedRetentionDays: 30 })
    render(<SettingsModal />)
    open('tasks')
    const input = screen.getByRole(name === 'Follow-up interval' ? 'textbox' : 'spinbutton', { name }) as HTMLInputElement
    const stored = input.value
    input.focus()
    fireEvent.change(input, { target: { value: typed } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe(stored)
    expect(useUIStore.getState().settingsOpen).toBe(true)
    fireEvent.keyDown(input, { key: 'Escape' })
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

  it('the theme control sets the theme mode', async () => {
    render(<SettingsModal />)
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    await waitFor(() => expect(useSettingsStore.getState().themeMode).toBe('light'))
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
  })
})
