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
    '--color-marker-focus-bg', '--color-marker-urgent-bg', '--color-marker-important-bg', '--color-marker-focus-text',
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
    // Its typed token's tint (`/urgent`) takes the color too.
    expect(root.style.getPropertyValue('--color-marker-urgent-bg')).toBe('color-mix(in srgb, #00ff00 12%, transparent)')
    // Danger keeps its own.
    expect(swatch('Danger accent').value).toBe('#ff0000')
    expect(root.style.getPropertyValue('--color-danger')).toBe('#ff0000')
    expect((await db.settings.get('color.dark.urgent'))!.value).toBe('#00ff00')

    // Reset: Urgent follows the default Danger again.
    fireEvent.click(getByText(document.body, /reset dark to defaults/i))
    await waitFor(() => expect(root.style.getPropertyValue('--color-marker-urgent')).toBe(''))
    expect(root.style.getPropertyValue('--color-marker-urgent-bg')).toBe('')
    expect(swatch('Urgent priority').value).toBe(DEFAULT_THEMED_COLORS.dark.danger)
  })

  describe('a row’s Reset (cr34, answer 18)', () => {
    const reset = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Reset ${label}"]`)
    const swatch = (label: string) => document.querySelector<HTMLInputElement>(`input[type="color"][aria-label="${label}"]`)!

    it('only a row with a color of its own has one', async () => {
      await useSettingsStore.getState().setColor('dark', 'urgent', '#00ff00')
      await useSettingsStore.getState().setColor('dark', 'surface', '#222222')
      render(<ThemeColorsEditor onClose={() => {}} />)
      expect(reset('Urgent priority')).not.toBeNull()
      expect(reset('Surface')).not.toBeNull()
      expect(document.querySelectorAll('button[aria-label^="Reset "]')).toHaveLength(2)
      expect(reset('Urgent priority')).toHaveTextContent(/^Reset$/)
      // What it does, in the tooltip: a priority follows a color; any other has a default.
      expect(reset('Urgent priority')).toHaveAttribute('title', 'Use the Danger accent color again')
      expect(reset('Surface')).toHaveAttribute('title', 'Use the default color again')
    })

    it('a color set in the editor gets its Reset at once', async () => {
      render(<ThemeColorsEditor onClose={() => {}} />)
      expect(reset('Focus priority')).toBeNull()
      fireEvent.change(swatch('Focus priority'), { target: { value: '#3b82f6' } })
      await waitFor(() => expect(reset('Focus priority')).not.toBeNull())
    })

    it('resets that one priority: it follows Danger again — its override included — and the other overrides stay', async () => {
      await useSettingsStore.getState().setColor('dark', 'danger', '#ff0000')
      await useSettingsStore.getState().setColor('dark', 'urgent', '#00ff00')
      await useSettingsStore.getState().setColor('dark', 'focus', '#3b82f6')
      render(<ThemeColorsEditor onClose={() => {}} />)
      const root = document.documentElement
      expect(swatch('Urgent priority').value).toBe('#00ff00')

      fireEvent.click(reset('Urgent priority')!)
      await waitFor(() => expect(root.style.getPropertyValue('--color-marker-urgent')).toBe(''))
      expect(root.style.getPropertyValue('--color-marker-urgent-bg')).toBe('')
      expect(swatch('Urgent priority').value).toBe('#ff0000')
      expect(reset('Urgent priority')).toBeNull()
      await waitFor(async () => expect(await db.settings.get('color.dark.urgent')).toBeUndefined())
      // Danger and Focus keep their own.
      expect(swatch('Danger accent').value).toBe('#ff0000')
      expect(swatch('Focus priority').value).toBe('#3b82f6')
      expect(root.style.getPropertyValue('--color-marker-focus')).toBe('#3b82f6')
      expect(reset('Danger accent')).not.toBeNull()
      expect(reset('Focus priority')).not.toBeNull()
    })

    it('the focus moves to the row’s swatch (the button goes with the override)', async () => {
      await useSettingsStore.getState().setColor('dark', 'accent', '#ff0000')
      render(<ThemeColorsEditor onClose={() => {}} />)
      const button = reset('Accent')!
      button.focus()
      fireEvent.click(button)
      await waitFor(() => expect(reset('Accent')).toBeNull())
      expect(document.activeElement).toBe(swatch('Accent'))
      expect(swatch('Accent').value).toBe(DEFAULT_THEMED_COLORS.dark.accent)
    })

    it('it resets the working theme’s color, not the other theme’s', async () => {
      await useSettingsStore.getState().setColor('dark', 'important', '#ff0000')
      await useSettingsStore.getState().setColor('light', 'important', '#0000ff')
      const { getByRole } = render(<ThemeColorsEditor onClose={() => {}} />)
      fireEvent.click(getByRole('tab', { name: 'Light' }))
      fireEvent.click(reset('Important priority')!)
      await waitFor(() => expect(useSettingsStore.getState().customizedColors.light).toEqual([]))
      expect(useSettingsStore.getState().customizedColors.dark).toEqual(['important'])
      expect(useSettingsStore.getState().colors.dark.important).toBe('#ff0000')
      expect(swatch('Important priority').value).toBe(DEFAULT_THEMED_COLORS.light.star)
    })
  })

  it('Focus’s own color is its typed token’s text and fill', async () => {
    await useSettingsStore.getState().setColor('dark', 'focus', '#3b82f6')
    const root = document.documentElement
    expect(root.style.getPropertyValue('--color-marker-focus')).toBe('#3b82f6')
    expect(root.style.getPropertyValue('--color-marker-focus-text')).toBe('#3b82f6')
    expect(root.style.getPropertyValue('--color-marker-focus-bg')).toBe('color-mix(in srgb, #3b82f6 12%, transparent)')
    // The accent is not Focus's to change.
    expect(root.style.getPropertyValue('--color-accent')).toBe('')
    await useSettingsStore.getState().resetColors('dark')
    expect(root.style.getPropertyValue('--color-marker-focus-text')).toBe('')
    expect(root.style.getPropertyValue('--color-marker-focus-bg')).toBe('')
  })
})
