import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { AppearanceSection } from '../../../components/settings/sections/AppearanceSection'
import { useSettingsStore } from '../../../stores/settings-store'
import { db } from '../../../data/database'
import { resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

afterEach(cleanup)

describe('AppearanceSection — default list zoom', () => {
  it('offers Stacked | Rows | Lines under the theme, Rows checked by default; a pick is saved and Rows removes the row', async () => {
    render(<AppearanceSection />)
    const group = screen.getByRole('radiogroup', { name: 'Default list zoom' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Stacked', 'Rows', 'Lines'])
    expect(within(group).getByRole('radio', { name: 'Rows' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/How a list tab draws its tasks until you zoom it/)).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('radio', { name: 'Lines' }))
    await waitFor(() => expect(useSettingsStore.getState().listZoom).toBe('lines'))
    expect(within(group).getByRole('radio', { name: 'Lines' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(async () => expect((await db.settings.get('rowDensity'))?.value).toBe('lines'))

    fireEvent.click(within(group).getByRole('radio', { name: 'Rows' }))
    await waitFor(() => expect(useSettingsStore.getState().listZoom).toBe('rows'))
    await waitFor(async () => expect(await db.settings.get('rowDensity')).toBeUndefined())
  })
})

describe('AppearanceSection — dates', () => {
  it('offers Relative | MM/DD, Relative checked by default; MM/DD is saved and Relative removes the row', async () => {
    render(<AppearanceSection />)
    const group = screen.getByRole('radiogroup', { name: 'Dates' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Relative', 'MM/DD'])
    expect(within(group).getByRole('radio', { name: 'Relative' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(group).getByRole('radio', { name: 'MM/DD' }))
    await waitFor(() => expect(useSettingsStore.getState().rowDates).toBe('numeric'))
    expect(within(group).getByRole('radio', { name: 'MM/DD' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(async () => expect((await db.settings.get('rowDates'))?.value).toBe('numeric'))

    fireEvent.click(within(group).getByRole('radio', { name: 'Relative' }))
    await waitFor(() => expect(useSettingsStore.getState().rowDates).toBe('relative'))
    await waitFor(async () => expect(await db.settings.get('rowDates')).toBeUndefined())
  })
})
