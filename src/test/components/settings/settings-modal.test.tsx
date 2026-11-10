import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within, waitFor } from '@testing-library/react'
import { ConfirmPromptHost } from '../../../components/overlays/ConfirmPromptHost'
import { SettingsModal } from '../../../components/settings/SettingsModal'
import { emptyPredicate } from '../../../models/filter-predicate'
import { useLensDraftStore } from '../../../stores/lens-draft-store'
import { readLastSettingsSection, SETTINGS_SECTION_KEY, useUIStore } from '../../../stores/ui-store'
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

  it('opens on Appearance the first time', () => {
    render(<SettingsModal />)
    open()
    expect(sectionHeading()).toBe('Appearance')
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'true')
  })

  it('Database shows Import / Export first (exporting is the common errand)', () => {
    render(<SettingsModal />)
    open('database')
    expect(screen.getByRole('dialog', { name: 'Settings' }).querySelector('h3')?.textContent).toBe('Import / Export')
  })

  it('lists Database, Appearance, Tasks, People statuses & tags, Keyboard shortcuts, About — a merged section’s parts under it', () => {
    render(<SettingsModal />)
    open()
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Database', 'Import / Export', 'File storage', 'Backups', 'Data integrity',
      'Appearance', 'Theme and lists', 'Ambience',
      'Tasks', 'New tasks', 'Lists & rows', 'Lenses', 'Eisenhower', 'Completed tasks',
      'People, statuses & tags',
      'Keyboard shortcuts',
      'About',
    ])
  })

  it('a part in the nav opens its section scrolled to it, and is marked while in view', () => {
    // JSDOM has no layout: the content is 600px high, the Database parts 200px apart, none scrolled.
    const tops: Record<string, number> = { 'import-export': 0, 'file-storage': 200, backups: 400, 'data-integrity': 580 }
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const part = this.getAttribute('data-settings-part')
      const top = part ? (tops[part] ?? 0) : 0
      const bottom = this.matches('section[aria-labelledby]') && !part ? 600 : top
      return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }
    })
    try {
      render(<SettingsModal />)
      // A one-part section: no part to mark.
      open('about')
      const nav = screen.getByRole('navigation', { name: 'Settings sections' })
      const navPart = (id: string) => nav.querySelector<HTMLElement>(`[data-settings-nav-part="${id}"]`) as HTMLElement
      expect(nav.querySelectorAll('[aria-current="location"]')).toHaveLength(0)
      fireEvent.click(within(nav).getByRole('button', { name: 'Database' }))
      // The section opens at its top: its first part is the one in view.
      expect(navPart('import-export')).toHaveAttribute('aria-current', 'location')
      fireEvent.click(navPart('backups'))
      expect(sectionHeading()).toBe('Database')
      expect(within(nav).getByRole('button', { name: 'Database' })).toHaveAttribute('aria-current', 'true')
      // Jumped to and still in view (it can't scroll to the top): marked.
      expect(navPart('backups')).toHaveAttribute('aria-current', 'location')
      expect(nav.querySelectorAll('[aria-current="location"]')).toHaveLength(1)
      expect(useUIStore.getState().settingsPart).toBeNull()
      // Another section's parts are never marked.
      expect(navPart('lenses')).not.toHaveAttribute('aria-current')
    } finally {
      spy.mockRestore()
    }
  })

  it('a description sits behind an ⓘ: hidden from view, read as the button’s description, shown on click', () => {
    render(<SettingsModal />)
    open('appearance')
    const info = screen.getByRole('button', { name: 'About Theme' })
    expect(info).toHaveAccessibleDescription('System follows your OS setting.')
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(info)
    expect(screen.getByRole('tooltip')).toHaveTextContent('System follows your OS setting.')
    // Escape closes the tip, not Settings.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
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

  describe('the last section, across reloads', () => {
    beforeEach(() => localStorage.removeItem(SETTINGS_SECTION_KEY))
    afterEach(() => localStorage.removeItem(SETTINGS_SECTION_KEY))

    it('is kept in this browser as each section shows, and read back as the section a reload opens on', () => {
      render(<SettingsModal />)
      expect(readLastSettingsSection()).toBe('appearance')
      open()
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'About' }))
      expect(localStorage.getItem(SETTINGS_SECTION_KEY)).toBe('about')
      expect(readLastSettingsSection()).toBe('about')
      // An explicit target (the storage pill's Import / Export) shows its own section, and is then the last one.
      act(() => useUIStore.getState().closeSettings())
      open('import-export')
      expect(sectionHeading()).toBe('Database')
      expect(readLastSettingsSection()).toBe('database')
    })

    it('a reload opens on it (the store starts from the stored section)', () => {
      localStorage.setItem(SETTINGS_SECTION_KEY, 'tasks')
      act(() => useUIStore.setState({ settingsSection: readLastSettingsSection() }))
      render(<SettingsModal />)
      open()
      expect(sectionHeading()).toBe('Tasks')
    })

    it('an unknown or unreadable stored value reads as Appearance', () => {
      localStorage.setItem(SETTINGS_SECTION_KEY, 'new-tasks')
      expect(readLastSettingsSection()).toBe('appearance')
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
      try {
        expect(readLastSettingsSection()).toBe('appearance')
      } finally {
        spy.mockRestore()
      }
    })
  })

  it('Tasks holds New tasks, Lists & rows, Lenses, Eisenhower, then Completed tasks; Database Import / Export, File storage, Backups, Data integrity — each headed', () => {
    render(<SettingsModal />)
    open('tasks')
    const parts = () => Array.from(screen.getByRole('dialog', { name: 'Settings' }).querySelectorAll('h3')).map((h) => h.textContent)
    expect(parts()).toEqual(['New tasks', 'Lists & rows', 'Lenses', 'Eisenhower', 'Completed tasks'])
    expect(screen.getByRole('region', { name: 'Completed tasks' })).toHaveAttribute('data-settings-part', 'completed')
    fireEvent.click(screen.getByRole('button', { name: 'Database' }))
    expect(parts()).toEqual(['Import / Export', 'File storage', 'Backups', 'Data integrity'])
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
    open('appearance')
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    await waitFor(() => expect(useSettingsStore.getState().themeMode).toBe('light'))
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('SettingsModal with a lens’s unsaved filter edits', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      lensPresetsSeeded: true,
      lenses: [{ id: 'lens-p', name: 'Plans', predicate: { ...emptyPredicate(), searchText: 'plan' } }],
    })
  })

  /** Settings on Tasks › Lenses, Plans open, its text filter removed (a draft). */
  function drafted() {
    render(<><SettingsModal /><ConfirmPromptHost /></>)
    open('lenses')
    fireEvent.click(within(screen.getByTestId('lens-list')).getByRole('button', { name: /^Plans/ }))
    fireEvent.click(within(screen.getByTestId('lens-filter')).getByRole('button', { name: 'Remove filter' }))
    expect(useLensDraftStore.getState().draft?.lensId).toBe('lens-p')
  }
  const prompt = () => screen.getByRole('dialog', { name: 'Save changes to lens “Plans”?' })
  const stillEditing = () => {
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'tasks' })
    expect(within(screen.getByTestId('lens-list')).getByRole('button', { name: /^Plans/ })).toHaveAttribute('aria-expanded', 'true')
    expect(useLensDraftStore.getState().draft?.lensId).toBe('lens-p')
  }

  it('× asks; Esc on the prompt is Keep editing — Settings stays on the lens with the draft', async () => {
    drafted()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    const save = within(prompt()).getByRole('button', { name: 'Save lens' })
    expect(save).toHaveFocus()
    expect(within(prompt()).getByRole('button', { name: /Keep editing/ })).toHaveTextContent('Esc')
    fireEvent.keyDown(save, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Save changes/ })).toBeNull())
    stillEditing()
  })

  it('Esc and a backdrop click ask too; Discard closes, the lens unchanged', async () => {
    drafted()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(within(prompt()).getByRole('button', { name: /Keep editing/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Save changes/ })).toBeNull())
    stillEditing()

    const backdrop = document.querySelector('[data-dialog-backdrop]')!
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    fireEvent.click(within(prompt()).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(useUIStore.getState().settingsOpen).toBe(false))
    expect(useSettingsStore.getState().lenses[0]!.predicate.searchText).toBe('plan')
    expect(useLensDraftStore.getState().draft).toBeNull()
  })

  it('another section asks; Save saves, then shows it', async () => {
    drafted()
    fireEvent.click(screen.getByRole('button', { name: 'Database' }))
    expect(sectionHeading()).toBe('Tasks')
    fireEvent.click(within(prompt()).getByRole('button', { name: 'Save lens' }))
    await waitFor(() => expect(sectionHeading()).toBe('Database'))
    expect(useSettingsStore.getState().lenses[0]!.predicate.searchText).toBe('')
  })

  it('reopened after a phone-width close (kept, not asked), the drafted lens is open and Unsaved', () => {
    drafted()
    act(() => useUIStore.getState().hideSettings())
    open()
    stillEditing()
    expect(within(screen.getByTestId('lens-list')).getByRole('button', { name: /^Plans/ })).toHaveTextContent('Unsaved')
  })

  it('reopened after a phone-width close on another section’s link, it shows Tasks › Lenses with the drafted lens focused', () => {
    drafted()
    act(() => useUIStore.getState().hideSettings())
    act(() => useUIStore.getState().setSettingsSection('database'))
    open('file-storage')
    expect(sectionHeading()).toBe('Tasks')
    stillEditing()
    expect(within(screen.getByTestId('lens-list')).getByRole('button', { name: /^Plans/ })).toHaveFocus()
    expect(useUIStore.getState()).toMatchObject({ settingsPart: null, settingsFocus: null })
  })
})
