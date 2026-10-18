import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { MOBILE_SETTINGS_SECTIONS, SETTINGS_SECTIONS } from '../../../components/settings/sections/settings-sections'
import { SETTINGS_PART_SECTION, resolveSettingsTarget, type SettingsPartId } from '../../../stores/ui-store'
import { SettingsPage } from '../../../views/SettingsPage'

afterEach(cleanup)

describe('Settings sections', () => {
  it('every part of a merged section maps to that section, and every mapped part is shown somewhere', () => {
    const shown = new Map<string, string>()
    for (const s of SETTINGS_SECTIONS) {
      if (s.parts.length > 1) for (const p of s.parts) shown.set(p.id, s.id)
    }
    expect(Object.fromEntries(shown)).toEqual(SETTINGS_PART_SECTION)
  })

  it('a target resolves to its section, and to its part when it names one', () => {
    expect(resolveSettingsTarget('database')).toEqual({ section: 'database', part: null })
    expect(resolveSettingsTarget('backups')).toEqual({ section: 'database', part: 'backups' })
    expect(resolveSettingsTarget('task-defaults' satisfies SettingsPartId)).toEqual({ section: 'tasks', part: 'task-defaults' })
  })

  it('the phone lists Appearance, Database and About; Database shows only Import / Export and File storage', () => {
    expect(MOBILE_SETTINGS_SECTIONS.map((s) => s.label)).toEqual(['Appearance', 'Database', 'About'])
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Database' }))
    const headings = Array.from(document.querySelectorAll('h3')).map((h) => h.textContent)
    expect(headings).toEqual(['Import / Export', 'File storage'])
  })

  it('the phone page opens on the section named in its route state (the storage status sheet)', () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/settings', state: { section: 'database' } }]}><SettingsPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Database')
    expect(screen.getByRole('button', { name: 'Back to Settings' })).toBeInTheDocument()
  })

  it('a part in the route state scrolls the phone page to it (File storage sits below Import / Export)', () => {
    // JSDOM has no layout: place the part 300px below the page's top.
    const rect = (top: number) => ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) })
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return rect(this.getAttribute('data-settings-part') === 'file-storage' ? 340 : 40)
    })
    try {
      render(<MemoryRouter initialEntries={[{ pathname: '/settings', state: { section: 'database', part: 'file-storage' } }]}><SettingsPage /></MemoryRouter>)
      const page = screen.getByRole('heading', { level: 1 }).closest('[data-settings-page]')
      expect(page).not.toBeNull()
      expect((page as HTMLElement).scrollTop).toBe(292)
    } finally {
      spy.mockRestore()
    }
  })
})
