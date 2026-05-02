import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ThemeColorsEditor } from '../../../components/settings/ThemeColorsEditor'
import { useSettingsStore } from '../../../stores/settings-store'
import { db } from '../../../data/database'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettingsStore.setState({
    themeMode: 'dark',
    colors: {
      dark: {
        accent: '#a2cfcb',
        canvasBg: '#0e0e0e',
        surface: '#191a1a',
        border: '#302e2b',
        header: '#1f2120',
        danger: '#ee7d77',
        warning: '#f5a623',
        star: '#f5c842',
        scheduled: '#7ec4bc',
        deadline: '#e86bf0',
      },
      light: {
        accent: '#3a9e93',
        canvasBg: '#f5f4f2',
        surface: '#ffffff',
        border: '#d9d5d0',
        header: '#f7fbfa',
        danger: '#d94a43',
        warning: '#d08a12',
        star: '#c09a15',
        scheduled: '#3a9e93',
        deadline: '#b838c0',
      },
    },
  })
})

afterEach(() => {
  cleanup()
  // Clear inline overrides set by setColor / setThemeMode side effects.
  const root = document.documentElement
  for (const v of [
    '--color-accent', '--color-canvas-bg', '--color-surface',
    '--color-border', '--color-header-bg',
    '--color-danger', '--color-warning', '--color-followup',
    '--color-scheduled', '--color-deadline', '--color-accent-dim',
  ]) root.style.removeProperty(v)
})

describe('ThemeColorsEditor', () => {
  it('seeds working theme from the resolved theme on mount and labels the header', () => {
    const { getByText } = render(<ThemeColorsEditor onClose={() => {}} />)
    // resolved theme is `dark` per beforeEach
    expect(getByText('Theme Colors — Dark')).toBeTruthy()
  })

  it('Light/Dark toggle binds the right working set', () => {
    const { getByRole, getAllByDisplayValue } = render(<ThemeColorsEditor onClose={() => {}} />)
    // Inputs reflect the dark bag.
    expect(getAllByDisplayValue('#a2cfcb').length).toBeGreaterThan(0)

    fireEvent.click(getByRole('tab', { name: 'Light' }))

    // Inputs now reflect the light bag.
    expect(getAllByDisplayValue('#3a9e93').length).toBeGreaterThan(0)
  })

  it('reset button targets only the working theme', async () => {
    // Pre-customize both bags through the store action — exercise the reset path
    // for the working theme only.
    await useSettingsStore.getState().setColor('dark', 'accent', '#ff0000')
    await useSettingsStore.getState().setColor('light', 'accent', '#0000ff')

    const { getByText } = render(<ThemeColorsEditor onClose={() => {}} />)
    fireEvent.click(getByText(/reset dark to defaults/i))

    await waitFor(() => {
      expect(useSettingsStore.getState().colors.dark.accent).toBe('#a2cfcb')
    })
    expect(useSettingsStore.getState().colors.light.accent).toBe('#0000ff')
  })
})
