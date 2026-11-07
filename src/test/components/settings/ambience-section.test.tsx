import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { AmbienceSection } from '../../../components/settings/sections/AmbienceSection'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUndoStore } from '../../../stores/undo-store'
import { db } from '../../../data/database'
import { DEFAULT_AMBIENCE } from '../../../models/ambience'
import { resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

afterEach(cleanup)

const stored = async () => {
  const row = await db.settings.get('ambience')
  return row ? (JSON.parse(row.value) as Record<string, unknown>) : undefined
}

describe('AmbienceSection', () => {
  it('starts on, at the defaults, with nothing stored', async () => {
    render(<AmbienceSection />)
    expect(screen.getByRole('switch', { name: 'Ambience' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Whisper' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('slider', { name: 'Header motion' })).toHaveValue('40')
    expect(screen.getByRole('switch', { name: 'Seasons' })).toHaveAttribute('aria-checked', 'true')
    expect(await stored()).toBeUndefined()
  })

  it('switches off and back, each an undo step; the row goes at the defaults', async () => {
    render(<AmbienceSection />)
    fireEvent.click(screen.getByRole('switch', { name: 'Ambience' }))
    await waitFor(async () => expect(await stored()).toMatchObject({ enabled: false }))
    expect(useSettingsStore.getState().ambience.enabled).toBe(false)
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Ambience off')
    fireEvent.click(screen.getByRole('switch', { name: 'Ambience' }))
    await waitFor(async () => expect(await stored()).toBeUndefined())
  })

  it('picks the sky and the seasons', async () => {
    render(<AmbienceSection />)
    fireEvent.click(screen.getByRole('radio', { name: 'Vivid' }))
    await waitFor(() => expect(useSettingsStore.getState().ambience.sky).toBe('vivid'))
    fireEvent.click(screen.getByRole('switch', { name: 'Seasons' }))
    await waitFor(async () => expect(await stored()).toMatchObject({ sky: 'vivid', seasons: false }))
  })

  it('moves Header motion as one undo step', async () => {
    render(<AmbienceSection />)
    const slider = screen.getByRole('slider', { name: 'Header motion' })
    fireEvent.change(slider, { target: { value: '55' } })
    fireEvent.change(slider, { target: { value: '70' } })
    await waitFor(async () => expect(await stored()).toMatchObject({ motion: 70 }))
    expect(screen.getByText('70%')).toBeInTheDocument()
    expect(useUndoStore.getState().undoStack.filter((e) => e.description.startsWith('Header motion'))).toHaveLength(1)
  })

  it('saves a typed place, refuses one out of range, and goes back to the guess', async () => {
    render(<AmbienceSection />)
    const [lat, lon] = screen.getAllByRole('textbox')
    if (!lat || !lon) throw new Error('no place fields')
    fireEvent.change(lat, { target: { value: '95' } })
    fireEvent.blur(lat)
    expect(screen.getByRole('alert')).toHaveTextContent('Latitude runs from −90 to 90')
    expect(useSettingsStore.getState().ambience.place).toBeNull()

    fireEvent.change(lat, { target: { value: '-33.868' } })
    fireEvent.change(lon, { target: { value: '151.209' } })
    fireEvent.blur(lon)
    await waitFor(() => expect(useSettingsStore.getState().ambience.place).toEqual({ lat: -33.87, lon: 151.21 }))
    expect(screen.getByText(/^Today the sun rises at/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use time zone guess' }))
    await waitFor(() => expect(useSettingsStore.getState().ambience.place).toBeNull())
    await waitFor(async () => expect(await stored()).toBeUndefined())
    expect(useSettingsStore.getState().ambience).toEqual(DEFAULT_AMBIENCE)
  })
})
