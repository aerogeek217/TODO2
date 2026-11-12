import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, getByText, waitFor } from '@testing-library/react'
import { ThemeColorsEditor } from '../../../components/settings/ThemeColorsEditor'
import { useSettingsStore } from '../../../stores/settings-store'
import { db } from '../../../data/database'
import { DEFAULT_THEMED_COLORS } from '../../../models/theme-colors'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettingsStore.setState({
    themeMode: 'dark',
    colors: { dark: { ...DEFAULT_THEMED_COLORS.dark }, light: { ...DEFAULT_THEMED_COLORS.light } },
  })
})

afterEach(() => {
  cleanup()
  // Clear inline overrides set by setColor / setThemeMode side effects.
  const root = document.documentElement
  for (const v of [
    '--color-accent', '--color-app-bg', '--color-surface',
    '--color-border', '--color-header-bg',
    '--color-danger', '--color-warning', '--color-followup',
    '--color-deadline', '--color-accent-dim',
    '--color-marker-focus', '--color-marker-urgent', '--color-marker-important',
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
    expect(getAllByDisplayValue(DEFAULT_THEMED_COLORS.dark.accent).length).toBeGreaterThan(0)

    fireEvent.click(getByRole('tab', { name: 'Light' }))

    // Inputs now reflect the light bag.
    expect(getAllByDisplayValue(DEFAULT_THEMED_COLORS.light.accent).length).toBeGreaterThan(0)
  })

  it('reset button targets only the working theme', async () => {
    // Pre-customize both bags through the store action — exercise the reset path
    // for the working theme only.
    await useSettingsStore.getState().setColor('dark', 'accent', '#ff0000')
    await useSettingsStore.getState().setColor('light', 'accent', '#0000ff')

    const { getByText } = render(<ThemeColorsEditor onClose={() => {}} />)
    fireEvent.click(getByText(/reset dark to defaults/i))

    await waitFor(() => {
      expect(useSettingsStore.getState().colors.dark.accent).toBe(DEFAULT_THEMED_COLORS.dark.accent)
    })
    expect(useSettingsStore.getState().colors.light.accent).toBe('#0000ff')
  })

  it('a priority shows the color it follows until it is given its own', async () => {
    await useSettingsStore.getState().setColor('dark', 'danger', '#ff0000')
    const { getByLabelText } = render(<ThemeColorsEditor onClose={() => {}} />)
    const swatch = (label: string) => getByLabelText(label) as HTMLInputElement
    const root = document.documentElement

    // Urgent follows Danger, its override included; nothing of its own is written.
    expect(swatch('Urgent priority').value).toBe('#ff0000')
    expect(swatch('Focus priority').value).toBe(DEFAULT_THEMED_COLORS.dark.accent)
    expect(swatch('Important priority').value).toBe(DEFAULT_THEMED_COLORS.dark.star)
    expect(root.style.getPropertyValue('--color-marker-urgent')).toBe('')

    fireEvent.change(swatch('Urgent priority'), { target: { value: '#00ff00' } })
    await waitFor(() => expect(root.style.getPropertyValue('--color-marker-urgent')).toBe('#00ff00'))
    expect(swatch('Urgent priority').value).toBe('#00ff00')
    // Danger keeps its own.
    expect(swatch('Danger accent').value).toBe('#ff0000')
    expect(root.style.getPropertyValue('--color-danger')).toBe('#ff0000')
    expect((await db.settings.get('color.dark.urgent'))!.value).toBe('#00ff00')

    // Reset: Urgent follows the default Danger again.
    fireEvent.click(getByText(document.body, /reset dark to defaults/i))
    await waitFor(() => expect(root.style.getPropertyValue('--color-marker-urgent')).toBe(''))
    expect(swatch('Urgent priority').value).toBe(DEFAULT_THEMED_COLORS.dark.danger)
  })
})
